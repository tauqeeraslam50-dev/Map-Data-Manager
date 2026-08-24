global using Brush = Mapsui.Styles.Brush;
global using Pen = Mapsui.Styles.Pen;

namespace MapDataManager;

// Compatibility wrapper for the ZstdNet API used by the PMTiles reader.
// It keeps the PMTiles implementation independent of the exact package overloads.
internal sealed class Decompressor : IDisposable
{
    private readonly ZstdNet.Decompressor _inner = new();

    public byte[] Unwrap(byte[] source)
    {
        if (source is null) throw new ArgumentNullException(nameof(source));
        var size = ZstdNet.Decompressor.GetDecompressedSize(source);
        if (size == 0 || size > int.MaxValue)
            throw new InvalidDataException("Zstandard frame does not contain a usable decompressed size.");
        return _inner.Unwrap(source, checked((int)size));
    }

    public void Dispose() => _inner.Dispose();
}
