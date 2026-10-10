import 'dart:io';
import 'dart:typed_data';

const bool supportsDirectProjectWrite = true;

Future<void> writeProjectFile(String path, Uint8List bytes) =>
    File(path).writeAsBytes(bytes, flush: true);
