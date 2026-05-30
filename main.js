require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;

// Scan Windows filesystem for installed real browsers
function scanBrowsers() {
  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Local');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const candidates = [
    { name: "Google Chrome", path: path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { name: "Microsoft Edge", path: path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { name: "Brave Browser", path: path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') }
  ];

  const found = {};
  for (const item of candidates) {
    if (fs.existsSync(item.path)) {
      found[item.name.toLowerCase().replace(' ', '_')] = item.path;
    }
  }
  return found;
}

const installedBrowsers = scanBrowsers();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 380,
    transparent: true, // Transparent window!
    frame: false,       // Frameless border!
    alwaysOnTop: true,  // Always on top!
    resizable: false,
    hasShadow: false,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Simple direct context for lightweight IPC
    }
  });

  mainWindow.loadFile('index.html');

  // Positoning: Bottom right corner just above the taskbar
  mainWindow.setPosition(1450, 680); 
  
  // Set window as click-through where transparent (custom utility if needed, 
  // but standard HTML pointer-events handles this beautifully inside renderer!)
  
  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', () => {
  createWindow();
  startActiveWindowScanner();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) createWindow();
});

// IPC BRIDGES FOR DRAGGING AND WINDOW CONTROLS
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

// Lets the renderer send the window positioning updates during drag!
ipcMain.on('window-move', (event, { x, y }) => {
  if (mainWindow) {
    mainWindow.setPosition(x, y);
  }
});

// Lets the renderer toggle the window size between compact (pet-only) and expanded (panel-open)
ipcMain.on('window-resize', (event, { width, height }) => {
  if (mainWindow) {
    mainWindow.setSize(width, height);
  }
});

// SAFE WIN32 SYSTEM TASK EXECUTOR REGISTRY
ipcMain.handle('system-execute', async (event, { action, param }) => {
  console.log(`[System Exec] Action: ${action} | Parameter: ${param}`);
  
  return new Promise((resolve) => {
    try {
      switch (action) {
        case 'open_url':
          // Safely opens url in user's default browser on Windows
          exec(`start "" "${param}"`, (err) => {
            if (err) resolve({ success: false, error: err.message });
            else resolve({ success: true });
          });
          break;
          
        case 'launch_app':
          // Launches common apps: code (VS Code), notepad, calc
          let cmd = param.toLowerCase() === 'code' ? 'code' : param;
          exec(`start "" "${cmd}"`, (err) => {
            if (err) resolve({ success: false, error: err.message });
            else resolve({ success: true });
          });
          break;

        case 'start_study_music':
          // Plays a beautiful Chill Lofi study stream on YouTube
          const musicUrl = "https://www.youtube.com/watch?v=jfKfPfyJRdk";
          exec(`start "" "${musicUrl}"`, (err) => {
            if (err) resolve({ success: false, error: err.message });
            else resolve({ success: true });
          });
          break;

        case 'git_sync':
          // Auto commits and syncs their LeetCode folder!
          const folderPath = "C:\\Users\\Varshan\\Documents\\antigravity\\magical-hypatia";
          exec(`cd "${folderPath}" && git add . && git commit -m "sync: auto-commit from Desktop Pet 🚀" && git push`, (err, stdout) => {
            if (err) resolve({ success: false, error: err.message });
            else resolve({ success: true, data: stdout });
          });
          break;

        case 'sys_info':
          // Queries Windows memory metrics
          exec('wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /Value', (err, stdout) => {
            if (err) {
              resolve({ success: false, error: err.message });
            } else {
              // Parse wmic output
              const lines = stdout.split('\n');
              let free = 0, total = 0;
              for (const line of lines) {
                if (line.includes('FreePhysicalMemory')) free = parseInt(line.split('=')[1], 10);
                if (line.includes('TotalVisibleMemorySize')) total = parseInt(line.split('=')[1], 10);
              }
              const usedPercent = Math.round(((total - free) / total) * 100);
              resolve({ success: true, data: { freeKB: free, totalKB: total, percent: usedPercent } });
            }
          });
          break;

        default:
          resolve({ success: false, error: `Unknown system action: ${action}` });
      }
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
});

// MULTIMODAL MENTOR CHAT PIPELINE (GEMINI 3.5 ROUTER)
ipcMain.handle('ai-chat', async (event, { userMessage, chatHistory, activeWindow }) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { success: false, error: "GEMINI_API_KEY is missing from .env!" };
  }

  try {
    const ai = new GoogleGenerativeAI(apiKey);
    const model = ai.getGenerativeModel({ model: "gemini-3.5-flash" });

    // Design a structured router prompt instructing Gemini to return JSON
    const systemPrompt = `
    You are the brain of "Pico", a highly advanced, witty, and supportive floating desktop pet and personal assistant.
    You talk out-loud to your user, Varshan, in a friendly, conversational, and energetic tone.
    Currently, Varshan is viewing this window on his PC: "${activeWindow || 'Desktop'}"

    YOUR CAPABILITIES:
    You can trigger local OS actions by returning a structured command JSON block.
    The supported actions are:
    1. "open_url" (param: website link, e.g. "https://leetcode.com/problemset/") - opens LeetCode, YouTube, or pw.live.
    2. "launch_app" (param: executable like "code", "notepad", "calc") - opens VS Code, etc.
    3. "start_study_music" (no param) - plays a study Lofi stream.
    4. "git_sync" (no param) - commits and pushes LeetCode files.
    5. "sys_info" (no param) - reports RAM usage.
    6. "start_pomodoro" (param: minutes, e.g., 25) - starts a countdown study timer.
    7. "none" (no param) - standard conversation.

    INSTRUCTIONS:
    - If Varshan asks you to open a site, launch an app, start music, sync git, or run a timer, you MUST set the correct "action" and "param".
    - Your speech response must be friendly, concise (1-2 sentences), and highly engaging.
    - You must respond ONLY with a valid, clean JSON block matching the schema below. No markdown wrappers (like \`\`\`json), no trailing text.

    JSON SCHEMA:
    {
      "speech": "concise spoken response to Varshan",
      "action": "one of the supported action strings, or 'none'",
      "param": "string parameter or null",
      "animation": "one of: 'happy', 'coding', 'studying', 'sleeping', 'idle'"
    }
    `;

    // Package chat history
    let messages = [{ role: "user", parts: [{ text: systemPrompt }] }];
    
    // Add history
    if (chatHistory && chatHistory.length > 0) {
      chatHistory.forEach(msg => {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        });
      });
    }

    // Add user message
    messages.push({ role: "user", parts: [{ text: userMessage }] });

    const chat = model.startChat({ history: messages });
    const result = await chat.sendMessage(userMessage);
    const responseText = result.response.text().trim();

    // Clean up markdown block wraps if Gemini accidentally added them
    let cleanJson = responseText;
    if (cleanJson.startsWith('```')) {
      const lines = cleanJson.split('\n');
      cleanJson = lines.slice(1, -1).join('\n').trim();
    }

    try {
      const parsed = JSON.parse(cleanJson);
      return { success: true, ...parsed };
    } catch (e) {
      // Fallback in case JSON parsing failed
      return {
        success: true,
        speech: responseText.substring(0, 150),
        action: "none",
        param: null,
        animation: "idle"
      };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// HIGH-SPEED WIN32 ACTIVE WINDOW SCANNER
function startActiveWindowScanner() {
  // Query every 2 seconds in the background
  setInterval(() => {
    if (!mainWindow) return;

    // Direct Win32 GetForegroundWindow call wrapped in a high-speed PowerShell script
    const psCommand = `powershell -Command "Add-Type '@[DllImport(\\"user32.dll\\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\\"user32.dll\\")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);' -Name 'Win32' -Namespace 'API'; [IntPtr]$handle = [API.Win32]::GetForegroundWindow(); $Builder = New-Object System.Text.StringBuilder 256; [void][API.Win32]::GetWindowText($handle, $Builder, 256); $Builder.ToString()"`;

    exec(psCommand, (err, stdout) => {
      if (err) return;
      
      const activeTitle = stdout.trim();
      if (activeTitle) {
        // Send foreground window title to the renderer UI
        mainWindow.webContents.send('active-window', activeTitle);
      }
    });
  }, 2000);
}
