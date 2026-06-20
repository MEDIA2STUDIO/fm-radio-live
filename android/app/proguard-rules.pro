# ProGuard rules for FM Radio Live
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-keep public class * extends android.app.Activity
-keep class com.fmradio.app.** { *; }
