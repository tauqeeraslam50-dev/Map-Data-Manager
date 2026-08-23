using Microsoft.Data.Sqlite;

namespace MapDataManager.Desktop.Services;

public sealed record OfflineImportResult(
    string MbTilesPath,
    int TileCount,
    int MinZoom,
    int MaxZoom,
    double MinLongitude,
    double MinLatitude,
    double MaxLongitude,
    double MaxLatitude);

public sealed class OfflineMapImporter
{
    public async Task<OfflineImportResult> ImportXyzFolderAsync(
        string sourceFolder,
        string destinationMbtiles,
        IProgress<int>? progress = null,
        CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(sourceFolder))
            throw new DirectoryNotFoundException(sourceFolder);

        var tiles = Directory.EnumerateFiles(sourceFolder, "*.*", SearchOption.AllDirectories)
            .Where(IsImage)
            .Select(path => TryParseTile(sourceFolder, path))
            .Where(t => t is not null)
            .Cast<TileFile>()
            .ToList();

        if (tiles.Count == 0)
            throw new InvalidOperationException("No XYZ tiles were found. Expected folders such as z\\x\\y.png.");

        Directory.CreateDirectory(Path.GetDirectoryName(destinationMbtiles)!);
        if (File.Exists(destinationMbtiles)) File.Delete(destinationMbtiles);

        var minZoom = tiles.Min(t => t.Z);
        var maxZoom = tiles.Max(t => t.Z);
        var minLon = double.PositiveInfinity;
        var minLat = double.PositiveInfinity;
        var maxLon = double.NegativeInfinity;
        var maxLat = double.NegativeInfinity;

        foreach (var tile in tiles)
        {
            var b = TileBounds(tile.Z, tile.X, tile.Y);
            minLon = Math.Min(minLon, b.MinLon);
            minLat = Math.Min(minLat, b.MinLat);
            maxLon = Math.Max(maxLon, b.MaxLon);
            maxLat = Math.Max(maxLat, b.MaxLat);
        }

        await using var connection = new SqliteConnection($"Data Source={destinationMbtiles}");
        await connection.OpenAsync(cancellationToken);

        await ExecuteAsync(connection, "PRAGMA journal_mode=WAL;");
        await ExecuteAsync(connection, "CREATE TABLE metadata (name TEXT PRIMARY KEY, value TEXT);");
        await ExecuteAsync(connection, "CREATE TABLE tiles (zoom_level INTEGER NOT NULL, tile_column INTEGER NOT NULL, tile_row INTEGER NOT NULL, tile_data BLOB NOT NULL, PRIMARY KEY (zoom_level, tile_column, tile_row));");
        await ExecuteAsync(connection, "CREATE INDEX tiles_zxy ON tiles (zoom_level, tile_column, tile_row);");

        await InsertMetadataAsync(connection, "name", "Imported Offline Map");
        await InsertMetadataAsync(connection, "type", "baselayer");
        await InsertMetadataAsync(connection, "version", "1.0");
        await InsertMetadataAsync(connection, "format", "png");
        await InsertMetadataAsync(connection, "minzoom", minZoom.ToString());
        await InsertMetadataAsync(connection, "maxzoom", maxZoom.ToString());
        await InsertMetadataAsync(connection, "bounds", $"{minLon},{minLat},{maxLon},{maxLat}");

        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.Transaction = (SqliteTransaction)transaction;
        command.CommandText = "INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES ($z,$x,$y,$data);";
        var pz = command.Parameters.Add("$z", SqliteType.Integer);
        var px = command.Parameters.Add("$x", SqliteType.Integer);
        var py = command.Parameters.Add("$y", SqliteType.Integer);
        var pd = command.Parameters.Add("$data", SqliteType.Blob);

        for (var i = 0; i < tiles.Count; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var tile = tiles[i];
            var data = await File.ReadAllBytesAsync(tile.Path, cancellationToken);
            pz.Value = tile.Z;
            px.Value = tile.X;
            // MBTiles uses TMS row numbering; downloaded XYZ folders use slippy-map Y.
            py.Value = (1L << tile.Z) - 1 - tile.Y;
            pd.Value = data;
            await command.ExecuteNonQueryAsync(cancellationToken);
            progress?.Report((i + 1) * 100 / tiles.Count);
        }

        await transaction.CommitAsync(cancellationToken);
        await connection.CloseAsync();

        return new OfflineImportResult(destinationMbtiles, tiles.Count, minZoom, maxZoom, minLon, minLat, maxLon, maxLat);
    }

    private static bool IsImage(string path)
    {
        var e = Path.GetExtension(path).ToLowerInvariant();
        return e is ".png" or ".jpg" or ".jpeg" or ".webp";
    }

    private static TileFile? TryParseTile(string root, string path)
    {
        var rel = Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/');
        var parts = rel.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 3) return null;
        if (!int.TryParse(parts[0], out var z) || !int.TryParse(parts[1], out var x)) return null;
        var yName = Path.GetFileNameWithoutExtension(parts[2]);
        if (!int.TryParse(yName, out var y) || z < 0 || z > 30 || x < 0 || y < 0) return null;
        return new TileFile(path, z, x, y);
    }

    private static (double MinLon, double MinLat, double MaxLon, double MaxLat) TileBounds(int z, int x, int y)
    {
        var n = Math.Pow(2, z);
        var minLon = x / n * 360.0 - 180.0;
        var maxLon = (x + 1) / n * 360.0 - 180.0;
        static double Lat(double t, double n) => 180.0 / Math.PI * Math.Atan(Math.Sinh(Math.PI * (1 - 2 * t / n)));
        var maxLat = Lat(y, n);
        var minLat = Lat(y + 1, n);
        return (minLon, minLat, maxLon, maxLat);
    }

    private static async Task ExecuteAsync(SqliteConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    private static async Task InsertMetadataAsync(SqliteConnection connection, string name, string value)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO metadata(name,value) VALUES($name,$value);";
        command.Parameters.AddWithValue("$name", name);
        command.Parameters.AddWithValue("$value", value);
        await command.ExecuteNonQueryAsync();
    }

    private sealed record TileFile(string Path, int Z, int X, int Y);
}
