Add-Type -AssemblyName System.Drawing

$sourcePath = Join-Path $PSScriptRoot '..\assets\cut_studio_icon.png'
$outputPath = Join-Path $PSScriptRoot '..\windows\runner\resources\app_icon.ico'
$source = [System.Drawing.Bitmap]::FromFile($sourcePath)
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$frames = @()

foreach ($size in $sizes) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.DrawImage($source, 0, 0, $size, $size)
  $graphics.Dispose()

  $xor = New-Object System.IO.MemoryStream
  for ($y = $size - 1; $y -ge 0; $y--) {
    for ($x = 0; $x -lt $size; $x++) {
      $pixel = $bitmap.GetPixel($x, $y)
      $xor.WriteByte($pixel.B); $xor.WriteByte($pixel.G); $xor.WriteByte($pixel.R); $xor.WriteByte($pixel.A)
    }
  }
  $bitmap.Dispose()

  $mask = New-Object System.IO.MemoryStream
  $maskRowBytes = [int]([Math]::Ceiling($size / 32) * 4)
  for ($y = $size - 1; $y -ge 0; $y--) {
    $row = New-Object byte[] $maskRowBytes
    for ($x = 0; $x -lt $size; $x++) {
      if ($source.GetPixel([Math]::Min($source.Width - 1, [int](($x + 0.5) * $source.Width / $size)), [Math]::Min($source.Height - 1, [int](($y + 0.5) * $source.Height / $size))).A -lt 128) {
        $row[[int][Math]::Floor($x / 8)] = $row[[int][Math]::Floor($x / 8)] -bor (0x80 -shr ($x % 8))
      }
    }
    $mask.Write($row, 0, $row.Length)
  }
  $maskBytes = $mask.ToArray()
  $frameStream = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($frameStream)
  $writer.Write([UInt32]40)
  $writer.Write([Int32]$size)
  $writer.Write([Int32]($size * 2))
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]0)
  $writer.Write([UInt32]$xor.Length)
  $writer.Write([Int32]0); $writer.Write([Int32]0); $writer.Write([UInt32]0); $writer.Write([UInt32]0)
  $writer.Write($xor.ToArray()); $writer.Write($maskBytes)
  $writer.Flush()
  $frames += ,@{ Size = $size; Bytes = $frameStream.ToArray() }
  $writer.Dispose(); $frameStream.Dispose(); $mask.Dispose(); $xor.Dispose()
}
$source.Dispose()

$output = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($output)
$writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]$frames.Count)
$offset = 6 + (16 * $frames.Count)
foreach ($frame in $frames) {
  $entrySize = [byte]($frame.Size % 256)
  $writer.Write($entrySize); $writer.Write($entrySize); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([UInt16]1); $writer.Write([UInt16]32)
  $writer.Write([UInt32]$frame.Bytes.Length); $writer.Write([UInt32]$offset)
  $offset += $frame.Bytes.Length
}
foreach ($frame in $frames) { $writer.Write($frame.Bytes) }
$writer.Flush()
[System.IO.File]::WriteAllBytes($outputPath, $output.ToArray())
$writer.Dispose(); $output.Dispose()
Write-Output "Wrote multi-size Windows icon: $outputPath"
