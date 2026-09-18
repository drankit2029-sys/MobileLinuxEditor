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
  NativeModules,
  NativeEventEmitter,
} from 'react-native';
import { WebView } from 'react-native-webview';
import RNFS from 'react-native-fs';

// ---------------------------------------------------------------------------
// Native VM bridge (LinuxVMBridge pod). Guarded: older builds lack it.
// ---------------------------------------------------------------------------
const { LinuxVMBridge } = NativeModules as any;
const vmEvents = LinuxVMBridge ? new NativeEventEmitter(LinuxVMBridge) : null;

// base64("poweroff\n") - guest shutdown via serial, no btoa needed in RN.
const POWEROFF_B64 = 'cG93ZXJvZmYK';

// ---------------------------------------------------------------------------
// Inlined editor page (byte-identical to assets/editor/index.html).
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Serial terminal page (xterm.js pinned: xterm 5.3.0 + addon-fit 0.8.0).
// RN -> page : window.termWrite(base64)
// page -> RN : postMessage { type:'term-input', data: base64 }
// ---------------------------------------------------------------------------
const TERMINAL_HTML: string = String.raw`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Serial Console</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css">
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #0c0c0c; overflow: hidden; }
    #terminal { height: 100%; width: 100%; padding: 8px; box-sizing: border-box; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js"></script>
</head>
<body>
  <div id="terminal"></div>
  <script>
    var term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, monospace',
      scrollback: 2000,
      theme: { background: '#0c0c0c', foreground: '#e0e0e0' }
    });
    var fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(document.getElementById('terminal'));
    fit.fit();
    window.addEventListener('resize', function () { fit.fit(); });
    term.writeln('Serial console. Press Start VM, then log in as root (no password).');

    function b64ToText(b64) {
      var s = atob(b64);
      var bytes = new Uint8Array(s.length);
      for (var i = 0; i < s.length; i++) { bytes[i] = s.charCodeAt(i); }
      return new TextDecoder().decode(bytes);
    }
    window.termWrite = function (b64) {
      try { term.write(b64ToText(b64)); } catch (e) {}
    };
    term.onData(function (d) {
      var bytes = new TextEncoder().encode(d);
      var s = '';
      for (var i = 0; i < bytes.length; i++) { s += String.fromCharCode(bytes[i]); }
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'term-input', data: btoa(s) }));
    });
    term.focus();
  </script>
</body>
</html>`;

const ACCESSORY_KEYS = [
  'Tab', '{', '}', '(', ')', '[', ']', ';', ':', '=',
  '"', '\'', '`', '/', '\\', '<', '>', '|', '$', '&'
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Tab = 'editor' | 'terminal';

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const termViewRef = useRef<WebView>(null);
  const [tab, setTab] = useState<Tab>('editor');
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const [vmStatus, setVmStatus] = useState<string>('idle');
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

  // VM + serial event wiring (terminal tab)
  useEffect(() => {
    if (!vmEvents) return;
    const subs = [
      vmEvents.addListener('SerialData', (e: any) => {
        if (e && e.data) {
          termViewRef.current?.injectJavaScript(`window.termWrite("${e.data}"); true;`);
        }
      }),
      vmEvents.addListener('VMStatus', (e: any) => {
        if (e && e.status) {
          setVmStatus(e.status === 'started' || e.status === 'serial-connected' ? 'running' : e.status);
        }
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  const startVM = async () => {
    if (!LinuxVMBridge) {
      setVmStatus('needs rebuild');
      return;
    }
    setVmStatus('starting');
    try {
      await LinuxVMBridge.startVM();
      // QEMU opens its serial socket server during init; retry until it answers.
      let connected = false;
      for (let i = 0; i < 12; i++) {
        try {
          await LinuxVMBridge.connectSerial();
          connected = true;
          break;
        } catch (_) {
          await sleep(500);
        }
      }
      // Native side now retries the serial connect for up to 10 min, so a
      // miss here is not fatal; the 'serial-connected' VMStatus event will
      // flip the pill to running whenever the socket comes up.
      setVmStatus(connected ? 'running' : 'starting');
    } catch (err: any) {
      setVmStatus('error: ' + (err.message || err));
    }
  };

  const stopVM = async () => {
    if (!LinuxVMBridge) return;
    try {
      // Graceful guest shutdown typed over the serial console; if the guest is
      // not at a shell (e.g. login prompt) that never runs, so after a short
      // grace period ask QEMU itself to quit via QMP (native stopVM).
      try { await LinuxVMBridge.writeSerial(POWEROFF_B64); } catch (_) {}
      setVmStatus('shutting down');
      await sleep(6000);
      try { await LinuxVMBridge.stopVM(); } catch (_) {}
    } catch (err: any) {
      setVmStatus('error: ' + (err.message || err));
    }
  };

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

  const handleTermMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'term-input' && data.data && LinuxVMBridge) {
        await LinuxVMBridge.writeSerial(data.data);
      }
    } catch (_) {
      // Serial not connected yet; ignore keystrokes.
    }
  };

  const statusColor =
    vmStatus === 'running' ? '#4caf50' :
    vmStatus === 'starting' || vmStatus === 'shutting down' ? '#ff9800' :
    vmStatus === 'idle' ? '#888888' : '#f44336';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, tab === 'editor' && styles.tabActive]}
          onPress={() => setTab('editor')}>
          <Text style={[styles.tabText, tab === 'editor' && styles.tabTextActive]}>Editor</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'terminal' && styles.tabActive]}
          onPress={() => setTab('terminal')}>
          <Text style={[styles.tabText, tab === 'terminal' && styles.tabTextActive]}>Terminal</Text>
        </TouchableOpacity>
      </View>

      {tab === 'editor' ? (
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
      ) : (
        <View style={styles.termWrapper}>
          <View style={styles.vmBar}>
            <View style={[styles.pill, { backgroundColor: statusColor }]}>
              <Text style={styles.pillText}>{vmStatus}</Text>
            </View>
            <TouchableOpacity style={styles.vmBtn} onPress={startVM}>
              <Text style={styles.vmBtnText}>Start VM</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.vmBtn, styles.vmBtnStop]} onPress={stopVM}>
              <Text style={styles.vmBtnText}>Stop</Text>
            </TouchableOpacity>
          </View>
          <WebView
            ref={termViewRef}
            source={{ html: TERMINAL_HTML }}
            originWhitelist={['*']}
            style={styles.webview}
            onMessage={handleTermMessage}
            onError={(e) => console.warn('Terminal error:', e.nativeEvent.description)}
            scrollEnabled={false}
            hideKeyboardAccessoryView={true}
          />
        </View>
      )}

      {tab === 'editor' && keyboardHeight > 0 && (
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
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1e1e1e',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#00d2ff' },
  tabText: { color: '#888888', fontSize: 15, fontWeight: '600' },
  tabTextActive: { color: '#ffffff' },
  editorWrapper: { flex: 1 },
  termWrapper: { flex: 1, backgroundColor: '#0c0c0c' },
  webview: { flex: 1, backgroundColor: '#121212' },
  vmBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#1e1e1e',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  pill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, marginRight: 8 },
  pillText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  vmBtn: {
    backgroundColor: '#007aff',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  vmBtnStop: { backgroundColor: '#5a5a5a' },
  vmBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
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
