import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';

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
  final List<PlatformFile> _media = [];
  String _projectName = 'Summer campaign / v04';
  int _selectedClip = 0;

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
            onPressed: _generateEdit,
            icon: const Icon(Icons.auto_awesome, size: 16),
            label: const Text('AI edit'),
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
                  child: Image.network(
                    'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=1600&q=85',
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const _PreviewFallback(),
                  ),
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
              Column(mainAxisSize: MainAxisSize.min, children: [
                const Text('A little more golden hour.', style: TextStyle(fontSize: 29, fontWeight: FontWeight.w600, shadows: [Shadow(color: Colors.black54, blurRadius: 12)])),
                const SizedBox(height: 12),
                Container(width: 260, height: 3, decoration: BoxDecoration(color: Colors.white30, borderRadius: BorderRadius.circular(5)), child: Align(alignment: Alignment.centerLeft, child: Container(width: 92, decoration: BoxDecoration(color: const Color(0xFFB8F36B), borderRadius: BorderRadius.circular(5))))),
              ]),
              Positioned(
                bottom: 18,
                child: Row(children: [
                  IconButton(onPressed: () => setState(() => _playing = !_playing), icon: Icon(_playing ? Icons.pause_rounded : Icons.play_arrow_rounded, size: 30)),
                  const Text('00:12.4', style: TextStyle(fontFeatures: [])),
                  const Text('  /  00:48.0', style: TextStyle(color: Colors.white54)),
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
            const Text('00:12.4', style: TextStyle(fontSize: 12)),
            const Spacer(),
            IconButton(visualDensity: VisualDensity.compact, onPressed: () => _toast('Timeline zoomed out'), icon: const Icon(Icons.remove, size: 17)),
            const Text('100%', style: TextStyle(fontSize: 11, color: Colors.white54)),
            IconButton(visualDensity: VisualDensity.compact, onPressed: () => _toast('Timeline zoomed in'), icon: const Icon(Icons.add, size: 17)),
          ]),
          const SizedBox(height: 10),
          _track('VIDEO 1', const Color(0xFF648850), const [0.92, 1.28, .82, 1.05, .72]),
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
              decoration: BoxDecoration(color: color.withValues(alpha: .64), borderRadius: BorderRadius.circular(5)),
            child: label == 'VIDEO 1' ? InkWell(onTap: () => setState(() => _selectedClip++), child: const _MiniThumbnail()) : null,
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
            : ListView.builder(padding: const EdgeInsets.symmetric(horizontal: 10), itemCount: _media.length, itemBuilder: (context, i) => ListTile(dense: true, leading: const Icon(Icons.video_file_outlined), title: Text(_media[i].name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11)), subtitle: Text(_fileSize(_media[i].size), style: const TextStyle(fontSize: 10)), onTap: () => setState(() => _selectedClip = i))))),
      ]);

  Widget _inspector() => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Padding(padding: EdgeInsets.fromLTRB(18, 20, 18, 14), child: Text('AI ASSISTANT', style: TextStyle(fontSize: 10, letterSpacing: 1.5, color: Color(0xFFB8F36B), fontWeight: FontWeight.bold))),
        Padding(padding: const EdgeInsets.symmetric(horizontal: 14), child: Container(padding: const EdgeInsets.all(14), decoration: BoxDecoration(color: const Color(0xFF1D211A), border: Border.all(color: const Color(0xFF39442F)), borderRadius: BorderRadius.circular(10)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('What should we make?', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 10),
          TextField(maxLines: 3, decoration: InputDecoration(hintText: '“Make this feel like a travel film…”', hintStyle: const TextStyle(fontSize: 12, color: Colors.white38), filled: true, fillColor: const Color(0xFF111310), border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none), contentPadding: const EdgeInsets.all(11))),
          const SizedBox(height: 10),
          SizedBox(width: double.infinity, child: FilledButton.icon(onPressed: _generateEdit, icon: const Icon(Icons.auto_awesome, size: 15), label: const Text('Generate edit'))),
        ]))),
        const Padding(padding: EdgeInsets.fromLTRB(18, 24, 18, 8), child: Text('QUICK ACTIONS', style: TextStyle(fontSize: 10, letterSpacing: 1.5, color: Colors.white54, fontWeight: FontWeight.bold))),
        _action(Icons.content_cut, 'Remove silences', 'Tighten the pacing', onTap: () => _showSuggestion('Silence removal', 'Find pauses in dialogue and tighten the cuts while keeping natural breathing room.')),
        _action(Icons.subtitles, 'Create captions', 'Accurate, styled subtitles', onTap: () => setState(() => _captions = !_captions), trailing: Switch(value: _captions, onChanged: (v) => setState(() => _captions = v))),
        _action(Icons.graphic_eq, 'Clean up audio', 'Reduce noise, balance levels', onTap: () => _showSuggestion('Audio cleanup', 'Reduce steady background noise, level dialogue, and keep music beneath speech.')),
        _action(Icons.auto_fix_high, 'Color match', 'Unify every shot', onTap: () => _showSuggestion('Color match', 'Match exposure and white balance across the selected shots, then apply a warm film look.')),
        const Divider(height: 26, indent: 18, endIndent: 18),
        const Padding(padding: EdgeInsets.symmetric(horizontal: 18), child: Text('SELECTED CLIP', style: TextStyle(fontSize: 10, letterSpacing: 1.5, color: Colors.white54, fontWeight: FontWeight.bold))),
        const SizedBox(height: 12),
        _slider('Exposure', .58), _slider('Contrast', .64), _slider('Saturation', .71),
        const Spacer(),
      ]);

  Widget _mobileTools() => SizedBox(height: 66, child: Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: ['Edit', 'AI', 'Captions', 'Audio', 'Export'].map((label) => TextButton(onPressed: () => setState(() => _tool = label), child: Text(label, style: TextStyle(color: _tool == label ? const Color(0xFFB8F36B) : Colors.white60)))).toList()));
  Widget _panelNav(IconData icon, String label, String? count) => ListTile(dense: true, leading: Icon(icon, size: 19, color: Colors.white70), title: Text(label, style: const TextStyle(fontSize: 13)), trailing: count == null ? null : Text(count, style: const TextStyle(color: Colors.white38, fontSize: 11)));
  Widget _action(IconData icon, String title, String sub, {Widget? trailing, VoidCallback? onTap}) => ListTile(dense: true, onTap: onTap, leading: Icon(icon, color: const Color(0xFFB8F36B), size: 19), title: Text(title, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500)), subtitle: Text(sub, style: const TextStyle(fontSize: 10, color: Colors.white45)), trailing: trailing);
  Widget _slider(String name, double value) => Padding(padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 4), child: Column(children: [Row(children: [Expanded(child: Text(name, style: const TextStyle(fontSize: 11, color: Colors.white70))), Text('${(value * 100).round()}', style: const TextStyle(fontSize: 10, color: Colors.white38))]), SizedBox(height: 22, child: Slider(value: value, onChanged: (_) {}, activeColor: const Color(0xFFB8F36B)))]));
  Widget _tag(IconData icon, String text) => Container(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7), decoration: BoxDecoration(color: Colors.black.withValues(alpha: .45), borderRadius: BorderRadius.circular(20)), child: Row(children: [Icon(icon, size: 13, color: const Color(0xFFB8F36B)), const SizedBox(width: 6), Text(text, style: const TextStyle(fontSize: 10))]));
  void _toast(String message) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message), behavior: SnackBarBehavior.floating, duration: const Duration(seconds: 2)));

  Future<void> _importMedia() async {
    final selection = await FilePicker.platform.pickFiles(
      type: FileType.video,
      allowMultiple: true,
    );
    if (selection == null || !mounted) return;
    setState(() {
      _media.addAll(selection.files);
      _selectedClip = _media.length - selection.files.length;
    });
    _toast('Added ${selection.files.length} video${selection.files.length == 1 ? '' : 's'} to your media bin');
  }

  String _fileSize(int bytes) {
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  void _generateEdit() {
    _showSuggestion('Your edit plan', _media.isEmpty
        ? 'Import your footage first. Then Cut Studio can arrange your clips, tighten the pacing, add captions, and shape the story around your prompt.'
        : 'Use ${_media.length} imported clip${_media.length == 1 ? '' : 's'} to build a 48 second story. Start with the strongest opening shot, tighten pauses, add captions, and finish on a clean audio fade.');
  }

  void _showSuggestion(String title, String description) {
    showDialog<void>(context: context, builder: (context) => AlertDialog(
      title: Row(children: [const Icon(Icons.auto_awesome, color: Color(0xFFB8F36B)), const SizedBox(width: 10), Text(title)]),
      content: Text('$description\n\nAI suggestions are previews in this prototype; media processing will be connected in a later build.'),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Got it'))],
    ));
  }

  void _showExport() {
    showDialog<void>(context: context, builder: (context) => AlertDialog(
      title: const Text('Export video'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        DropdownButtonFormField<String>(value: '4K', decoration: const InputDecoration(labelText: 'Resolution'), items: ['4K', '1080p', '720p'].map((v) => DropdownMenuItem(value: v, child: Text(v))).toList(), onChanged: (_) {}),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(value: 'H.264 (MP4)', decoration: const InputDecoration(labelText: 'Format'), items: ['H.264 (MP4)', 'HEVC (MP4)', 'ProRes (MOV)'].map((v) => DropdownMenuItem(value: v, child: Text(v))).toList(), onChanged: (_) {}),
        const SizedBox(height: 12),
        const Text('Export rendering will be available when the video render engine is connected.', style: TextStyle(color: Colors.white54, fontSize: 12)),
      ]),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
    ));
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
