plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Signing: the GitHub build passes a keystore through environment variables (repository secrets).
// Without them the app is signed with the standard debug key, which is fine for testing.
val ksFile = System.getenv("DV_KEYSTORE_FILE")
val ksPass = System.getenv("DV_KEYSTORE_PASSWORD")

android {
    namespace = "ph.docuvault.go"
    compileSdk = 35

    defaultConfig {
        applicationId = "ph.docuvault.go"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("DV_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("DV_VERSION_NAME") ?: "1.0.0"
    }

    signingConfigs {
        if (ksFile != null && ksPass != null) {
            create("release") {
                storeFile = file(ksFile)
                storePassword = ksPass
                keyAlias = System.getenv("DV_KEY_ALIAS") ?: "docuvault"
                keyPassword = ksPass
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (ksFile != null && ksPass != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.11.0")
    // Google's on-phone document scanner (edge detection, crop, straighten, clean-up). Free, runs on the phone.
    implementation("com.google.android.gms:play-services-mlkit-document-scanner:16.0.0-beta1")
    // Google's on-phone text reader (Latin script). Free, works offline.
    implementation("com.google.mlkit:text-recognition:16.0.1")
}
