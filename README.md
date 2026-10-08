# Cut Studio

Cut Studio is a Flutter video editor prototype with a responsive desktop and mobile editing workspace.

## Run

Install Flutter, generate the platform runners, then run:

```sh
flutter create --platforms web,android,ios .
flutter pub get
flutter run -d chrome
```

Use `flutter run` with an attached Android or iOS device for the mobile layout.

## Current scope

Import video files into the media bin and timeline, select clips, move them left or right, remove them, adjust clip controls, and enter an edit prompt to get a reviewable edit plan. Mobile quick actions open AI, captions, audio, and export controls.

AI edit plans are currently local previews; they do not call an AI service. Video playback, clip trimming, persistent projects, generated captions, audio processing, and rendered video export are still to come.
