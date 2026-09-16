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
} from 'react-native';
import { WebView } from 'react-native-webview';
import RNFS from 'react-native-fs';

// Inlined editor page (was assets/editor/index.html). String.raw keeps every
// backslash byte-identical, so the page's own JS string escapes survive.
// Same content renders on iOS and Android - no platform file paths needed.
const EDITOR_HTML: string = String.raw`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Editor</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background-color: #121212;
      overflow: hidden;
    }
    #editor {
      height: 100%;
      width: 100%;
      font-family: Menlo, Monaco, 'Courier New', monospace;
      font-size: 14px;
    }
    .cm-editor {
      height: 100%;
    }
    .cm-scroller {
      overflow: auto;
    }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/dracula.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/javascript/javascript.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/python/python.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/clike/clike.min.js"></script>
</head>
<body>
  <div id="editor"
       autocapitalize="none"
       autocorrect="off"
       spellcheck="false"
       autocomplete="off"></div>

  <script>
    var editor = CodeMirror(document.getElementById("editor"), {
      value: "// Mobile Linux Workspace\n// Code saved here syncs directly to /root/workspace in Alpine Linux\n\nconsole.log('Hello from iOS sandbox');\n",
      mode: "javascript",
      theme: "dracula",
      lineNumbers: true,
      lineWrapping: true,
      inputStyle: "contenteditable"
    });

    // Expose programmatic insertion for React Native accessory keyboard bar
    window.insertSymbol = function(char) {
      var doc = editor.getDoc();
      var cursor = doc.getCursor();
      var insertText = (char === 'Tab') ? '  ' : char;
      doc.replaceRange(insertText, cursor);
      editor.focus();
    };

    // Notify React Native on content change
    editor.on("change", function() {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: "change",
          value: editor.getValue()
        }));
      }
    });
  </script>
</body>
</html>`;

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
          source={{ html: EDITOR_HTML }}
          originWhitelist={['*']}
          style={styles.webview}
          onMessage={handleMessage}
          onError={(e) => console.warn('WebView error:', e.nativeEvent.description)}
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
