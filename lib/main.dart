import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:video_player/video_player.dart';
import 'package:url_launcher/url_launcher.dart';

void main() => runApp(const CutStudioApp());

class CutStudioApp extends StatelessWidget {
  const CutStudioApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        debugShowCheckedModeBanner: false,
        title: 'Cut Studio',
        theme: ThemeData(
          brightness: Brightness.dark,
          scaffoldBackgroundColor: const Color(0xFF101114),
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFFB8F36B),
            brightness: Brightness.dark,
          ),
          fontFamily: 'Roboto',
        ),
        home: const EditorScreen(),
      );
}

class EditorScreen extends StatefulWidget {
  const EditorScreen({super.key});

  @override
  State<EditorScreen> createState() => _EditorScreenState();
}

class _EditorScreenState extends State<EditorScreen> {
  String _tool = 'Edit';
  bool _playing = false;
  bool _captions = true;
  bool _aiBusy = false;
  bool _mediaBusy = false;
  bool _renderBusy = false;
  bool _removeSilences = false;
  VideoPlayerController? _previewController;
  final List<String> _assetIds = [];
  final List<double> _durations = [];
  final List<RangeValues> _trimRanges = [];
  final List<Map<String, dynamic>> _captionSegments = [];
  String _exportResolution = '1080p';
  static const _aiEndpoint = String.fromEnvironment('AI_API_URL', defaultValue: 'http://localhost:8787/api/edit-plan');
  final List<PlatformFile> _media = [];
  final List<int> _timelineMedia = [];
  final TextEditingController _promptController = TextEditingController();
  final Map<String, double> _adjustments = {'Exposure': .58, 'Contrast': .64, 'Saturation': .71};
  String _projectName = 'Summer campaign / v04';
  int _selectedClip = -1;

  @override
  void dispose() {
    _promptController.dispose();
    _previewController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width > 900;
    return Scaffold(
      body: SafeArea(
        child: Column(children: [
          _topBar(),
          Expanded(
            child: wide
                ? Row(children: [
                    SizedBox(width: 270, child: _sidePanel()),
                    Expanded(child: _workspace()),
                    SizedBox(width: 300, child: _inspector()),
                  ])
                : Column(children: [
                    Expanded(child: _workspace()),
                    SizedBox(height: 248, child: _timeline()),
                    _mobileTools(),
                  ]),
          ),
        ]),
      ),
    );
  }

  Widget _topBar() => Container(
        height: 66,
        padding: const EdgeInsets.symmetric(horizontal: 20),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: Color(0xFF25262A))),
        ),
        child: Row(children: [
          const Icon(Icons.movie_creation_outlined, color: Color(0xFFB8F36B)),
          const SizedBox(width: 10),
          const Text('CUTSTUDIO', style: TextStyle(fontWeight: FontWeight.w800, letterSpacing: 1.5)),
          const SizedBox(width: 24),
          const VerticalDivider(indent: 16, endIndent: 16),
          const SizedBox(width: 16),
          Expanded(child: Text(_projectName, style: const TextStyle(color: Colors.white70))),
          const Icon(Icons.cloud_done_outlined, size: 18, color: Colors.white54),
          const SizedBox(width: 8),
          const Text('Saved', style: TextStyle(color: Colors.white54, fontSize: 12)),
          const SizedBox(width: 20),
          OutlinedButton.icon(onPressed: _showExport, icon: const Icon(Icons.ios_share, size: 16), label: const Text('Export')),
          const SizedBox(width: 10),
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFB8F36B), foregroundColor: const Color(0xFF171A12)),
            onPressed: _aiBusy ? null : _generateEdit,
            icon: Icon(_aiBusy ? Icons.hourglass_top : Icons.auto_awesome, size: 16),
            label: Text(_aiBusy ? 'Planning…' : 'AI edit'),
          ),
        ]),
      );

  Widget _workspace() => Column(children: [
        Expanded(
          child: Container(
            margin: const EdgeInsets.all(18),
            width: double.infinity,
            decoration: BoxDecoration(color: const Color(0xFF08090B), borderRadius: BorderRadius.circular(14)),
            child: Stack(alignment: Alignment.center, children: [
              Positioned.fill(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: _previewController?.value.isInitialized == true
                      ? Center(child: AspectRatio(aspectRatio: _previewController!.value.aspectRatio, child: VideoPlayer(_previewController!)))
                      : const _PreviewFallback(),
                ),
              ),
              Positioned.fill(child: DecoratedBox(decoration: BoxDecoration(color: Colors.black.withValues(alpha: .23)))),
              Positioned(
                left: 24,
                top: 20,
                child: _tag(Icons.crop_16_9, '16:9  •  4K'),
              ),
              Positioned(
                right: 24,
                top: 20,
                child: _tag(Icons.auto_awesome, 'AI color grade'),
              ),

              Positioned(
                bottom: 18,
                child: Row(children: [
                  IconButton(onPressed: _togglePlayback, icon: Icon(_previewController?.value.isPlaying == true ? Icons.pause_rounded : Icons.play_arrow_rounded, size: 30)),
                  Text(_formatDuration(_previewController?.value.position ?? Duration.zero), style: const TextStyle(fontFeatures: [])),
                  Text('  /  ${_formatDuration(_previewController?.value.duration ?? Duration.zero)}', style: const TextStyle(color: Colors.white54)),
                  const SizedBox(width: 24),
                  IconButton(onPressed: () => _toast('Volume controls'), icon: const Icon(Icons.volume_up_outlined)),
          IconButton(onPressed: () => _showExport(), icon: const Icon(Icons.fullscreen)),
                ]),
              ),
            ]),
          ),
        ),
        if (MediaQuery.sizeOf(context).width > 900) SizedBox(height: 282, child: _timeline()),
      ]);

  Widget _timeline() => Container(
        margin: const EdgeInsets.fromLTRB(18, 0, 18, 16),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: const Color(0xFF18191D), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFF28292E))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Text('TIMELINE', style: TextStyle(fontSize: 11, letterSpacing: 1.3, color: Colors.white54, fontWeight: FontWeight.w700)),
            const SizedBox(width: 16),
            Expanded(child: Text(_selectedClip >= 0 && _selectedClip < _timelineMedia.length ? _media[_timelineMedia[_selectedClip]].name : 'No clip selected', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12))),
            IconButton(visualDensity: VisualDensity.compact, tooltip: 'Move clip left', onPressed: () => _moveSelectedClip(-1), icon: const Icon(Icons.chevron_left, size: 18)),
            IconButton(visualDensity: VisualDensity.compact, tooltip: 'Move clip right', onPressed: () => _moveSelectedClip(1), icon: const Icon(Icons.chevron_right, size: 18)),
            IconButton(visualDensity: VisualDensity.compact, tooltip: 'Remove clip', onPressed: _removeSelectedClip, icon: const Icon(Icons.delete_outline, size: 17)),
            const Spacer(),
            IconButton(visualDensity: VisualDensity.compact, onPressed: () => _toast('Timeline zoomed out'), icon: const Icon(Icons.remove, size: 17)),
            const Text('100%', style: TextStyle(fontSize: 11, color: Colors.white54)),
            IconButton(visualDensity: VisualDensity.compact, onPressed: () => _toast('Timeline zoomed in'), icon: const Icon(Icons.add, size: 17)),
          ]),
          const SizedBox(height: 10),
          _track('VIDEO 1', const Color(0xFF648850), _timelineMedia.isEmpty ? const [0.92, 1.28, .82, 1.05, .72] : _timelineMedia.map((i) => (_trimRanges[i].end - _trimRanges[i].start).clamp(.2, 20).toDouble()).toList()),
          const SizedBox(height: 7),
          _track('TEXT', const Color(0xFF8273B7), const [.66, .54, .82, .5]),
          const SizedBox(height: 7),
          _track('MUSIC', const Color(0xFF468E91), const [1.15, .88, 1.24, 1.08, .92]),
          const SizedBox(height: 7),
          _track('SFX', const Color(0xFFB08753), const [.38, .3, .48, .26]),
        ]),
      );

  Widget _track(String label, Color color, List<double> widths) => Expanded(
        child: Row(children: [
          SizedBox(width: 66, child: Text(label, style: const TextStyle(fontSize: 9, color: Colors.white54, letterSpacing: .8))),
          Expanded(child: LayoutBuilder(builder: (context, c) => Stack(children: [
            Row(children: List.generate(widths.length, (i) => Expanded(flex: (widths[i] * 100).round(), child: Container(
              margin: const EdgeInsets.only(right: 3),
              height: 36,
              decoration: BoxDecoration(color: color.withValues(alpha: .64), borderRadius: BorderRadius.circular(5), border: Border.all(color: label == 'VIDEO 1' && _selectedClip == i ? const Color(0xFFB8F36B) : Colors.transparent)),
              child: label == 'VIDEO 1' && _timelineMedia.isNotEmpty
                  ? InkWell(onTap: () => _selectTimelineClip(i), child: Center(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 5), child: Text(_media[_timelineMedia[i]].name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 9)))))
                  : label == 'VIDEO 1' ? const _MiniThumbnail() : null,
            )))),
            Positioned(left: c.maxWidth * .27, top: 0, bottom: 0, child: Container(width: 2, color: const Color(0xFFB8F36B))),
          ]))),
        ]),
      );

  Widget _sidePanel() => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Padding(padding: EdgeInsets.fromLTRB(18, 20, 18, 10), child: Text('PROJECT', style: TextStyle(fontSize: 10, letterSpacing: 1.5, color: Colors.white54, fontWeight: FontWeight.bold))),
        _panelNav(Icons.perm_media_outlined, 'Media', '12'),
        _panelNav(Icons.music_note_outlined, 'Audio', '4'),
        _panelNav(Icons.title, 'Titles', null),
        _panelNav(Icons.auto_awesome_motion_outlined, 'Transitions', null),
        _panelNav(Icons.filter_vintage_outlined, 'Effects', null),
        _panelNav(Icons.subtitles_outlined, 'Captions', null),
        const Divider(height: 30, indent: 18, endIndent: 18),
        Padding(padding: const EdgeInsets.symmetric(horizontal: 18), child: Row(children: [const Text('YOUR MEDIA', style: TextStyle(fontSize: 10, letterSpacing: 1.3, color: Colors.white54, fontWeight: FontWeight.bold)), const Spacer(), IconButton(tooltip: 'Import videos', onPressed: _importMedia, icon: const Icon(Icons.add, size: 18))])),
        const SizedBox(height: 12),
        Expanded(child: _media.isEmpty
            ? GridView.count(padding: const EdgeInsets.symmetric(horizontal: 14), crossAxisCount: 2, mainAxisSpacing: 8, crossAxisSpacing: 8, childAspectRatio: 1.5, children: const [
                _MediaTile(color: Color(0xFF5D684F), icon: Icons.landscape), _MediaTile(color: Color(0xFF5E625C), icon: Icons.waves), _MediaTile(color: Color(0xFF726250), icon: Icons.wb_twilight), _MediaTile(color: Color(0xFF4B6462), icon: Icons.forest),
              ])
            : ListView.builder(padding: const EdgeInsets.symmetric(horizontal: 10), itemCount: _media.length, itemBuilder: (context, i) => ListTile(dense: true, leading: const Icon(Icons.video_file_outlined), title: Text(_media[i].name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11)), subtitle: Text(_fileSize(_media[i].size), style: const TextStyle(fontSize: 10)), onTap: () => _insertToTimeline(i))))),
      ]);

  Widget _inspector() => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Padding(padding: EdgeInsets.fromLTRB(18, 20, 18, 14), child: Text('AI ASSISTANT', style: TextStyle(fontSize: 10, letterSpacing: 1.5, color: Color(0xFFB8F36B), fontWeight: FontWeight.bold))),
        Padding(padding: const EdgeInsets.symmetric(horizontal: 14), child: Container(padding: const EdgeInsets.all(14), decoration: BoxDecoration(color: const Color(0xFF1D211A), border: Border.all(color: const Color(0xFF39442F)), borderRadius: BorderRadius.circular(10)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('What should we make?', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 10),
          TextField(controller: _promptController, maxLines: 3, decoration: InputDecoration(hintText: '“Make this feel like a travel film…”', hintStyle: const TextStyle(fontSize: 12, color: Colors.white38), filled: true, fillColor: const Color(0xFF111310), border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none), contentPadding: const EdgeInsets.all(11))),
          const SizedBox(height: 10),
          SizedBox(width: double.infinity, child: FilledButton.icon(onPressed: _aiBusy ? null : _generateEdit, icon: Icon(_aiBusy ? Icons.hourglass_top : Icons.auto_awesome, size: 15), label: Text(_aiBusy ? 'Planning…' : 'Generate edit'))),
        ]))),
        const Padding(padding: EdgeInsets.fromLTRB(18, 24, 18, 8), child: Text('QUICK ACTIONS', style: TextStyle(fontSize: 10, letterSpacing: 1.5, color: Colors.white54, fontWeight: FontWeight.bold))),
        _action(Icons.content_cut, 'Remove silences', 'Tighten the pacing', onTap: () { setState(() => _removeSilences = !_removeSilences); _toast(_removeSilences ? 'Silence removal will be applied on export' : 'Silence removal turned off'); _runQuickAction('Remove silences', 'Analyze the selected video and remove long pauses while preserving a short natural breath.'); }),
        _action(Icons.subtitles, 'Create captions', 'Accurate, styled subtitles', onTap: _generateCaptions, trailing: Switch(value: _captions, onChanged: (v) { setState(() => _captions = v); if (v && _captionSegments.isEmpty) _generateCaptions(); })),
        _action(Icons.graphic_eq, 'Clean up audio', 'Reduce noise, balance levels', onTap: () => _runQuickAction('Clean up audio', 'Reduce steady background noise and normalize dialogue loudness.')),
        _action(Icons.auto_fix_high, 'Color match', 'Unify every shot', onTap: () => _runQuickAction('Color match', 'Match exposure and white balance across the selected shots, then suggest a consistent warm film look.')),
        const Divider(height: 26, indent: 18, endIndent: 18),
        const Padding(padding: EdgeInsets.symmetric(horizontal: 18), child: Text('SELECTED CLIP', style: TextStyle(fontSize: 10, letterSpacing: 1.5, color: Colors.white54, fontWeight: FontWeight.bold))),
        const SizedBox(height: 12),
        if (_selectedClip >= 0 && _selectedClip < _timelineMedia.length) ...[
          Padding(padding: const EdgeInsets.symmetric(horizontal: 18), child: Row(children: [const Expanded(child: Text('Trim range', style: TextStyle(fontSize: 11, color: Colors.white70))), Text('${_trimRanges[_timelineMedia[_selectedClip]].start.toStringAsFixed(1)}s — ${_trimRanges[_timelineMedia[_selectedClip]].end.toStringAsFixed(1)}s', style: const TextStyle(fontSize: 10, color: Colors.white38))])),
          Padding(padding: const EdgeInsets.symmetric(horizontal: 10), child: RangeSlider(min: 0, max: (_durations[_timelineMedia[_selectedClip]]).clamp(.2, 86400).toDouble(), values: _trimRanges[_timelineMedia[_selectedClip]], labels: RangeLabels('${_trimRanges[_timelineMedia[_selectedClip]].start.toStringAsFixed(1)}s', '${_trimRanges[_timelineMedia[_selectedClip]].end.toStringAsFixed(1)}s'), onChanged: (value) { setState(() { _trimRanges[_timelineMedia[_selectedClip]] = value; _captionSegments.clear(); }); final controller = _previewController; if (controller != null && (controller.value.position < Duration(milliseconds: (value.start * 1000).round()) || controller.value.position > Duration(milliseconds: (value.end * 1000).round()))) controller.seekTo(Duration(milliseconds: (value.start * 1000).round())); })),
        ],
        _slider('Exposure', .58), _slider('Contrast', .64), _slider('Saturation', .71),
        const Spacer(),
      ]);

  Widget _mobileTools() => SizedBox(height: 66, child: Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: ['Edit', 'AI', 'Captions', 'Audio', 'Export'].map((label) => TextButton(onPressed: () => _handleMobileTool(label), child: Text(label, style: TextStyle(color: _tool == label ? const Color(0xFFB8F36B) : Colors.white60)))).toList()));

  void _handleMobileTool(String label) {
    setState(() => _tool = label);
    switch (label) {
      case 'AI':
        showDialog<void>(context: context, builder: (dialogContext) => AlertDialog(title: const Text('AI edit'), content: TextField(controller: _promptController, maxLines: 3, decoration: const InputDecoration(hintText: 'Describe the edit you want')), actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')), FilledButton(onPressed: () { Navigator.pop(dialogContext); _generateEdit(); }, child: const Text('Plan edit'))]));
        break;
      case 'Captions':
        setState(() => _captions = !_captions);
        _toast(_captions ? 'Captions enabled' : 'Captions disabled');
        break;
      case 'Audio':
        _runQuickAction('Clean up audio', 'Reduce steady background noise and normalize dialogue loudness.');
        break;
      case 'Export':
        _showExport();
        break;
      default:
        break;
    }
  }
  Widget _panelNav(IconData icon, String label, String? count) => ListTile(dense: true, leading: Icon(icon, size: 19, color: Colors.white70), title: Text(label, style: const TextStyle(fontSize: 13)), trailing: count == null ? null : Text(count, style: const TextStyle(color: Colors.white38, fontSize: 11)));
  Widget _action(IconData icon, String title, String sub, {Widget? trailing, VoidCallback? onTap}) => ListTile(dense: true, onTap: onTap, leading: Icon(icon, color: const Color(0xFFB8F36B), size: 19), title: Text(title, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500)), subtitle: Text(sub, style: const TextStyle(fontSize: 10, color: Colors.white45)), trailing: trailing);
  Widget _slider(String name, double value) => Padding(padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 4), child: Column(children: [Row(children: [Expanded(child: Text(name, style: const TextStyle(fontSize: 11, color: Colors.white70))), Text('${((_adjustments[name] ?? value) * 100).round()}', style: const TextStyle(fontSize: 10, color: Colors.white38))]), SizedBox(height: 22, child: Slider(value: _adjustments[name] ?? value, onChanged: (next) => setState(() => _adjustments[name] = next), activeColor: const Color(0xFFB8F36B)))]));
  Widget _tag(IconData icon, String text) => Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7), decoration: BoxDecoration(color: Colors.black.withValues(alpha: .45), borderRadius: BorderRadius.circular(20)), child: Row(children: [Icon(icon, size: 13, color: const Color(0xFFB8F36B)), const SizedBox(width: 6), Text(text, style: const TextStyle(fontSize: 10))]));
  void _toast(String message) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message), behavior: SnackBarBehavior.floating, duration: const Duration(seconds: 2)));

  void _insertToTimeline(int mediaIndex) {
    setState(() {
      _timelineMedia.add(mediaIndex);
      _captionSegments.clear();
      _selectedClip = _timelineMedia.length - 1;
    });
    _toast('Added ${_media[mediaIndex].name} to the timeline');
    _loadPreview(_selectedClip);
  }

  void _moveSelectedClip(int direction) {
    final destination = _selectedClip + direction;
    if (_selectedClip < 0 || destination < 0 || destination >= _timelineMedia.length) return;
    setState(() {
      final clip = _timelineMedia.removeAt(_selectedClip);
      _timelineMedia.insert(destination, clip);
      _captionSegments.clear();
      _selectedClip = destination;
    });
  }

  void _removeSelectedClip() {
    if (_selectedClip < 0 || _selectedClip >= _timelineMedia.length) return;
    setState(() {
      _timelineMedia.removeAt(_selectedClip);
      _captionSegments.clear();
      _selectedClip = _timelineMedia.isEmpty ? -1 : _selectedClip.clamp(0, _timelineMedia.length - 1).toInt();
    });
    if (_selectedClip >= 0) { _loadPreview(_selectedClip); } else { _previewController?.dispose(); setState(() => _previewController = null); }
  }

  String get _backendBaseUrl => Uri.parse(_aiEndpoint).replace(path: '').toString().replaceFirst(RegExp(r'/$'), '');
  Uri _backendUri(String path) => Uri.parse(_backendBaseUrl).replace(path: path);

  Future<void> _importMedia() async {
    if (_mediaBusy) return;
    final selection = await FilePicker.platform.pickFiles(type: FileType.video, allowMultiple: true, withData: true);
    if (selection == null || !mounted) return;
    setState(() => _mediaBusy = true);
    var imported = 0;
    try {
      for (final file in selection.files) {
        final bytes = file.bytes;
        if (bytes == null) throw Exception('Could not read ${file.name}. Try selecting it again.');
        final request = http.MultipartRequest('POST', _backendUri('/api/media/import'))
          ..files.add(http.MultipartFile.fromBytes('file', bytes, filename: file.name));
        final streamed = await request.send().timeout(const Duration(minutes: 5));
        final response = await http.Response.fromStream(streamed);
        final result = jsonDecode(response.body);
        if (response.statusCode < 200 || response.statusCode >= 300) throw Exception(result['error'] ?? 'Import failed for ${file.name}.');
        final metadata = result as Map<String, dynamic>;
        if (!mounted) return;
        setState(() {
          final index = _media.length;
          _media.add(PlatformFile(name: file.name, size: file.size, path: file.path));
          _assetIds.add(metadata['id'] as String);
          final duration = (metadata['duration'] as num?)?.toDouble() ?? 0;
          _durations.add(duration);
          _trimRanges.add(RangeValues(0, duration > .1 ? duration : .1));
          _timelineMedia.add(index);
          _captionSegments.clear();
          _selectedClip = _timelineMedia.length - 1;
        });
        imported++;
        await _loadPreview(_selectedClip);
      }
      _toast('Imported $imported video${imported == 1 ? '' : 's'} and added to timeline');
    } catch (error) {
      if (mounted) _showError('Media import failed', error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _mediaBusy = false);
    }
  }

  Future<void> _loadPreview(int timelineIndex) async {
    if (timelineIndex < 0 || timelineIndex >= _timelineMedia.length) return;
    final mediaIndex = _timelineMedia[timelineIndex];
    final old = _previewController;
    _previewController = null;
    await old?.dispose();
    final controller = VideoPlayerController.networkUrl(_backendUri('/api/media/${_assetIds[mediaIndex]}'));
    _previewController = controller;
    try {
      await controller.initialize();
      await controller.setLooping(true);
      if (mounted && identical(_previewController, controller)) setState(() {});
    } catch (error) {
      await controller.dispose();
      if (identical(_previewController, controller)) _previewController = null;
      if (mounted) _showError('Preview unavailable', 'The media backend could not decode this video. $error');
    }
  }

  void _selectTimelineClip(int index) {
    if (index < 0 || index >= _timelineMedia.length) return;
    setState(() => _selectedClip = index);
    _loadPreview(index);
  }

  Future<void> _togglePlayback() async {
    final controller = _previewController;
    if (controller == null || !controller.value.isInitialized) return;
    if (controller.value.isPlaying) { await controller.pause(); } else { await controller.play(); }
    if (mounted) setState(() => _playing = controller.value.isPlaying);
  }

  String _formatDuration(Duration duration) {
    final minutes = duration.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = duration.inSeconds.remainder(60).toString().padLeft(2, '0');
    final tenths = (duration.inMilliseconds.remainder(1000) / 100).floor();
    return '$minutes:$seconds.$tenths';
  }

  void _showError(String title, String message) {
    showDialog<void>(context: context, builder: (dialogContext) => AlertDialog(title: Text(title), content: SelectableText(message), actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('OK'))]));
  }

  String _fileSize(int bytes) {
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  Future<void> _loadPreview(int timelineIndex) async {
    if (timelineIndex < 0 || timelineIndex >= _timelineMedia.length) return;
    final mediaIndex = _timelineMedia[timelineIndex];
    final old = _previewController; _previewController = null; await old?.dispose();
    final controller = VideoPlayerController.networkUrl(_backendUri('/api/media/${_assetIds[mediaIndex]}')); _previewController = controller;
    try {
      await controller.initialize(); await controller.setLooping(true);
      await controller.seekTo(Duration(milliseconds: (_trimRanges[mediaIndex].start * 1000).round()));
      controller.addListener(() {
        if (mounted && identical(_previewController, controller) && _selectedClip >= 0 && _selectedClip < _timelineMedia.length) {
          final trim = _trimRanges[_timelineMedia[_selectedClip]];
          if (controller.value.isPlaying && controller.value.position >= Duration(milliseconds: (trim.end * 1000).round())) controller.seekTo(Duration(milliseconds: (trim.start * 1000).round()));
          setState(() {});
        }
      });
      if (mounted && identical(_previewController, controller)) setState(() {});
    } catch (error) { await controller.dispose(); if (identical(_previewController, controller)) _previewController = null; if (mounted) _showError('Preview unavailable', 'The media backend could not decode this video. $error'); }
  }
  void _selectTimelineClip(int index) { if (index < 0 || index >= _timelineMedia.length) return; setState(() => _selectedClip = index); _loadPreview(index); }
  Future<void> _togglePlayback() async { final controller=_previewController; if(controller==null||!controller.value.isInitialized)return; if(controller.value.isPlaying){await controller.pause();}else{await controller.play();} if(mounted)setState(()=>_playing=controller.value.isPlaying); }
  String _formatDuration(Duration duration) { final m=duration.inMinutes.remainder(60).toString().padLeft(2,'0'),s=duration.inSeconds.remainder(60).toString().padLeft(2,'0'),t=(duration.inMilliseconds.remainder(1000)/100).floor(); return '$m:$s.$t'; }
  void _showError(String title,String message) { showDialog<void>(context:context,builder:(dialogContext)=>AlertDialog(title:Text(title),content:SelectableText(message),actions:[TextButton(onPressed:()=>Navigator.pop(dialogContext),child:const Text('OK'))])); }

  void _runQuickAction(String title, String instruction) {
    _promptController.text = '$title: $instruction';
    _generateEdit();
  }

  Future<void> _generateEdit() async {
    if (_aiBusy) return;
    setState(() => _aiBusy = true);
    final prompt = _promptController.text.trim().isEmpty
        ? 'Create a polished story from these clips.'
        : _promptController.text.trim();
    final clips = _timelineMedia.map((i) => {
      'name': _media[i].name,
      'sizeBytes': _media[i].size,
      'durationSeconds': _durations[i],
      'trimStart': _trimRanges[i].start,
      'trimEnd': _trimRanges[i].end,
    }).toList();
    try {
      final response = await http.post(
        Uri.parse(_aiEndpoint),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'prompt': prompt, 'clips': clips, 'captionsEnabled': _captions}),
      ).timeout(const Duration(seconds: 60));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final body = jsonDecode(response.body);
        throw Exception(body is Map ? (body['error'] ?? 'AI request failed') : 'AI request failed');
      }
      final plan = jsonDecode(response.body) as Map<String, dynamic>;
      if (!mounted) return;
      showDialog<void>(context: context, builder: (dialogContext) => AlertDialog(
        title: Row(children: [const Icon(Icons.auto_awesome, color: Color(0xFFB8F36B)), const SizedBox(width: 10), Expanded(child: Text(plan['title'] as String? ?? 'Your edit plan'))]),
        content: SizedBox(width: 460, child: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(plan['summary'] as String? ?? ''),
          const SizedBox(height: 16),
          for (final step in (plan['steps'] as List? ?? const []))
            Padding(padding: const EdgeInsets.only(bottom: 12), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(width: 24, height: 24, alignment: Alignment.center, decoration: const BoxDecoration(color: Color(0xFF28321F), shape: BoxShape.circle), child: Text('${step['order']}', style: const TextStyle(color: Color(0xFFB8F36B), fontSize: 11))),
              const SizedBox(width: 10),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(step['action'] ?? '', style: const TextStyle(fontWeight: FontWeight.w600)), const SizedBox(height: 3), Text(step['detail'] ?? '', style: const TextStyle(color: Colors.white60, fontSize: 12))])),
            ])),
          const Text('This is an edit plan. The current prototype does not yet apply these steps to footage or render an export.', style: TextStyle(color: Colors.white38, fontSize: 11)),
        ]))),
        actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Close'))],
      ));
    } catch (error) {
      if (!mounted) return;
      final message = error.toString().replaceFirst('Exception: ', '');
      showDialog<void>(context: context, builder: (dialogContext) => AlertDialog(
        title: const Text('AI edit is unavailable'),
        content: Text('$message\n\nStart the local AI backend with OPENAI_API_KEY set, then try again. For a device or deployed app, set AI_API_URL to a backend URL reachable from that device.'),
        actions: [TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('OK'))],
      ));
    } finally {
      if (mounted) setState(() => _aiBusy = false);
    }
  }

  void _showExport() {
    showDialog<void>(context: context, builder: (dialogContext) => StatefulBuilder(builder: (context, refresh) => AlertDialog(
      title: const Text('Render and quality check'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        DropdownButtonFormField<String>(value: _exportResolution, decoration: const InputDecoration(labelText: 'Resolution'), items: ['4K', '1080p', '720p'].map((v) => DropdownMenuItem(value: v, child: Text(v))).toList(), onChanged: (v) { if(v!=null) { setState(() => _exportResolution=v); refresh((){}); } }),
        const SizedBox(height: 12),
        Text(_renderBusy ? 'Rendering, normalizing audio, and checking output…' : 'Cuts are applied in order. The export uses H.264/AAC, your trim and color settings, audio leveling, and generated captions.'),
      ]),
      actions: [TextButton(onPressed: _renderBusy ? null : () => Navigator.pop(dialogContext), child: const Text('Cancel')), FilledButton.icon(onPressed: _renderBusy ? null : () async { await _renderProject(); if(context.mounted) Navigator.pop(dialogContext); }, icon: Icon(_renderBusy ? Icons.hourglass_top : Icons.movie_creation_outlined), label: Text(_renderBusy ? 'Rendering…' : 'Render video'))],
    )));
  }

  Future<void> _renderProject() async {
    if (_renderBusy) return;
    if (_timelineMedia.isEmpty) { _showError('Nothing to export', 'Add at least one video clip to the timeline.'); return; }
    setState(() => _renderBusy = true);
    try {
      final clips = _timelineMedia.map((i) => {
        'assetId': _assetIds[i], 'start': _trimRanges[i].start, 'end': _trimRanges[i].end, 'removeSilences': _removeSilences, 'removeSilences': _removeSilences,
        'exposure': _adjustments['Exposure'] ?? .58, 'contrast': _adjustments['Contrast'] ?? .64, 'saturation': _adjustments['Saturation'] ?? .71,
      }).toList();
      final response = await http.post(_backendUri('/api/render'), headers: {'Content-Type':'application/json'}, body: jsonEncode({'clips':clips,'resolution':_exportResolution,'captions':_captions ? _captionSegments : const []})).timeout(const Duration(minutes: 30));
      final result = jsonDecode(response.body);
      if (response.statusCode < 200 || response.statusCode >= 300) throw Exception(result['error'] ?? 'Render failed.');
      if (!mounted) return;
      final exportUrl = _backendUri(result['url'] as String);
      final metadata = result['metadata'] as Map<String,dynamic>;
      final qc = (result['qc'] as List? ?? const []).cast<Map<String,dynamic>>();
      showDialog<void>(context: context, builder: (dialogContext) => AlertDialog(
        title: const Text('Export complete'),
        content: SizedBox(width:460, child: SingleChildScrollView(child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children:[
          Text('${metadata['width']} × ${metadata['height']} • ${metadata['videoCodec']} • ${_formatDuration(Duration(milliseconds: ((metadata['duration'] as num).toDouble()*1000).round()))}'),
          const SizedBox(height: 14), const Text('QUALITY CHECK', style: TextStyle(fontSize:10,letterSpacing:1.2,color:Color(0xFFB8F36B),fontWeight:FontWeight.bold)),
          if(qc.isEmpty) const Padding(padding:EdgeInsets.only(top:8),child:Text('Passed basic codec, duration, dimensions, and stream checks.')),
          for(final item in qc) ListTile(dense:true, contentPadding:EdgeInsets.zero, leading:Icon(item['severity']=='error'?Icons.error_outline:item['severity']=='warning'?Icons.warning_amber:Icons.info_outline,color:item['severity']=='error'?Colors.redAccent:const Color(0xFFB8F36B)),title:Text(item['message'] as String,style:const TextStyle(fontSize:12))),
          const SizedBox(height:8), SelectableText(exportUrl.toString(),style:const TextStyle(fontSize:11,color:Colors.lightBlueAccent)),
        ]))),
        actions:[TextButton(onPressed:()=>Navigator.pop(dialogContext),child:const Text('Close')),FilledButton.icon(onPressed:()=>launchUrl(exportUrl,mode:LaunchMode.externalApplication),icon:const Icon(Icons.download),label:const Text('Open export'))],
      ));
    } catch(error) { if(mounted) _showError('Render failed',error.toString().replaceFirst('Exception: ','')); }
    finally { if(mounted) setState(()=>_renderBusy=false); }
  }

  Future<void> _generateCaptions() async {
    if(_timelineMedia.isEmpty) { _showError('Add footage first','Import and place at least one video on the timeline.'); return; }
    try {
      final segments=<Map<String,dynamic>>[]; var offset=0.0;
      for(final mediaIndex in _timelineMedia) {
        final response=await http.post(_backendUri('/api/captions'),headers:{'Content-Type':'application/json'},body:jsonEncode({'assetId':_assetIds[mediaIndex]})).timeout(const Duration(minutes:5));
        final result=jsonDecode(response.body);
        if(response.statusCode<200||response.statusCode>=300) throw Exception(result['error']??'Caption generation failed.');
        final trim=_trimRanges[mediaIndex];
        for(final segment in (result['segments'] as List? ?? const [])) {
          final begin=(segment['start'] as num).toDouble(), finish=(segment['end'] as num).toDouble();
          if(finish>trim.start && begin<trim.end) segments.add({'start':offset+(begin-trim.start).clamp(0,trim.end-trim.start),'end':offset+(finish-trim.start).clamp(0,trim.end-trim.start),'text':segment['text']});
        }
        offset+=trim.end-trim.start;
      }
      if(!mounted) return;
      setState(()=>{ _captions=true; _captionSegments..clear()..addAll(segments); });
      _toast('Generated ${segments.length} caption segments. Captions will be embedded in the MP4.');
    } catch(error) { if(mounted) _showError('Caption generation failed',error.toString().replaceFirst('Exception: ','')); }
  }

}

class _MiniThumbnail extends StatelessWidget {
  const _MiniThumbnail();
  @override
  Widget build(BuildContext context) => ClipRRect(borderRadius: BorderRadius.circular(5), child: Row(children: List.generate(8, (i) => Expanded(child: Container(color: Color.lerp(const Color(0xFF506047), const Color(0xFFB29A69), i / 8)))));
}

class _MediaTile extends StatelessWidget {
  final Color color;
  final IconData icon;
  const _MediaTile({required this.color, required this.icon});
  @override
  Widget build(BuildContext context) => Container(decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(7)), child: Icon(icon, color: Colors.white70));
}

class _PreviewFallback extends StatelessWidget {
  const _PreviewFallback();
  @override
  Widget build(BuildContext context) => const Center(child: Column(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.ondemand_video, size: 50, color: Colors.white30), SizedBox(height: 10), Text('Add footage to start editing', style: TextStyle(color: Colors.white54))]));
}
