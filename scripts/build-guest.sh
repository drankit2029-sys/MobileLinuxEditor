name: Build iOS Native Package

on:
  push:
    branches: [ main ]
  workflow_dispatch:

jobs:
  build:
    runs-on: macos-14

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: 'npm'

      - name: Install NPM Dependencies
        run: npm ci

      - name: Assemble UTM-QEMU Local Pod
        run: |
          echo "Setting up local Pod directory..."
          mkdir -p ios/UTM-QEMU/Frameworks
          mkdir -p ios/UTM-QEMU/Sources
          mkdir -p ios/UTM-QEMU/Resources
          
          # 1. Absorb the Native Bridge Code so CocoaPods compiles it automatically
          mv ios/LinuxVMBridge.m ios/UTM-QEMU/Sources/ 2>/dev/null || true
          
          # 2. Absorb the Linux Guest Assets so CocoaPods bundles them
          cp assets/guest/vmlinuz-virt ios/UTM-QEMU/Resources/
          cp assets/guest/initramfs-virt.cpio.gz ios/UTM-QEMU/Resources/
          
          cd ios/UTM-QEMU
          
          echo "Downloading precompiled UTM SE..."
          curl -L -o UTM-SE.zip https://github.com/utmapp/UTM/releases/download/v4.5.3/UTM-SE.ipa
          unzip -q UTM-SE.zip
          
          echo "Extracting dynamic frameworks..."
          mv Payload/*.app/Frameworks/*.framework ./Frameworks/
          
          # Remove all duplicate QEMU architectures to prevent linker crashes
          find Frameworks -type d -name "qemu-*.framework" ! -name "qemu-aarch64-softmmu.framework" -exec rm -rf {} +
          rm -rf Payload UTM-SE.zip

          echo "Generating Podspec..."
          cat << 'EOF' > UTM-QEMU.podspec
          Pod::Spec.new do |s|
            s.name         = "UTM-QEMU"
            s.version      = "1.0.0"
            s.summary      = "Prebuilt QEMU for iOS"
            s.homepage     = "https://github.com/utmapp/UTM"
            s.author       = "UTM"
            s.source       = { :path => "." }
            s.platform     = :ios, "14.0"
            s.source_files = "Sources/*.{h,m,swift}"
            s.resources    = "Resources/*"
            s.vendored_frameworks = "Frameworks/*.framework"
            s.dependency 'React-Core'
          end
          EOF

      - name: Inject Local Pod into Podfile
        run: |
          cd ios
          # Safely injects the new UTM-QEMU pod directly into your React Native target
          perl -pi -e "s/(target 'MobileLinuxEditor' do)/\$1\n  pod 'UTM-QEMU', :path => '.\/UTM-QEMU'/g" Podfile

      - name: CocoaPods Install
        run: |
          cd ios
          pod install

      - name: Compile iOS Archive
        run: |
          cd ios
          xcodebuild archive \
            -workspace MobileLinuxEditor.xcworkspace \
            -scheme MobileLinuxEditor \
            -configuration Release \
            -sdk iphoneos \
            -destination 'generic/platform=iOS' \
            -archivePath MobileLinuxEditor.xcarchive \
            CODE_SIGNING_ALLOWED=NO

      - name: Upload Build Artifact
        uses: actions/upload-artifact@v4
        with:
          name: MobileLinuxEditor-xcarchive
          path: ios/MobileLinuxEditor.xcarchive