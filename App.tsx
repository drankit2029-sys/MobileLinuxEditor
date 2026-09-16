import React, { useRef, useState, useEffect } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Keyboard,
  Platform,
  Alert,
} from 'react-native';
import { WebView } from 'react-native-webview';
import RNFS from 'react-native-fs';

const ACCESSORY_KEYS = [
  'Tab', '{', '}', '(', ')', '[', ']', ';', ':', '=', 
  '"', '\'', '`', '/', '\\', '<', '>', '|', '$', '&'
];

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const currentFileName = 'index.js';

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleInsert = (key: string) => {
    const js = `window.insertSymbol(${JSON.stringify(key)}); true;`;
    webViewRef.current?.injectJavaScript(js);
  };

  const handleMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'change') {
        const workspacePath = `${RNFS.DocumentDirectoryPath}/workspace`;
        const exists = await RNFS.exists(workspacePath);
        if (!exists) {
          await RNFS.mkdir(workspacePath);
        }
        await RNFS.writeFile(`${workspacePath}/${currentFileName}`, data.value, 'utf8');
      }
    } catch (err: any) {
      console.error('File write error:', err.message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.editorWrapper}>
        <WebView
          ref={webViewRef}
          source={{ uri: 'file:///android_asset/editor/index.html' }} // Bundled asset URI
          style={styles.webview}
          onMessage={handleMessage}
          scrollEnabled={false}
          hideKeyboardAccessoryView={true}
        />
      </View>

      {keyboardHeight > 0 && (
        <View style={[styles.accessoryBar, { bottom: keyboardHeight }]}>
          <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}>
            {ACCESSORY_KEYS.map((k) => (
              <TouchableOpacity key={k} style={styles.keyBtn} onPress={() => handleInsert(k)}>
                <Text style={styles.keyText}>{k}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  editorWrapper: { flex: 1 },
  webview: { flex: 1, backgroundColor: '#121212' },
  accessoryBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 44,
    backgroundColor: '#1e1e1e',
    borderTopWidth: 1,
    borderTopColor: '#333',
    flexDirection: 'row',
  },
  keyBtn: {
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 42,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#2a2a2a',
  },
  keyText: {
    color: '#00d2ff',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});