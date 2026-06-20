# FM Radio Live - Android APK Build Guide

## Prerequisites

1. **Android Studio** (download from https://developer.android.com/studio)
2. **Android SDK** (installed via Android Studio)

## How to Build APK

### Method 1: Using Android Studio (Recommended)

1. Open Android Studio
2. File → Open → Select `C:\Users\Administrator\Documents\Codex\fm-radio\android` folder
3. Wait for Gradle sync to complete
4. Build → Build Bundle(s) / APK(s) → Build APK(s)
5. APK will be at: `android\app\build\outputs\apk\debug\app-debug.apk`

### Method 2: Command Line

```bash
cd android
./gradlew assembleDebug
# APK at: app/build/outputs/apk/debug/app-debug.apk
```

### Method 3: Online Build (No Android Studio required)

Upload this `android` folder to:
1. https://appetize.io - Online Android emulator & build
2. https://www.pwabuilder.com - Convert web app to APK
3. https://cloud.google.com/android-build - Google Cloud Build

## Installing APK on Phone

1. Copy `app-debug.apk` to your Android phone
2. Enable "Install from Unknown Sources" in Settings
3. Tap the APK file to install
4. Open "FM Radio Live" app

## Changing the Server URL

The app loads `https://fm-radio.up.railway.app` by default.
To change it, edit `MainActivity.java` line 21:
```java
private static final String APP_URL = "https://your-railway-url.railway.app";
```

## Permissions Required

- **Internet** - To load the web app
- **Record Audio** - For microphone broadcasting
- **Network State** - To detect connectivity
