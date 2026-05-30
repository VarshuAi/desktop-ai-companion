const { ipcRenderer } = require('electron');

// --- CONSTANTS & CONFIGS ---
const COMPACT_WIDTH = 180;
const EXPANDED_WIDTH = 420;
const WINDOW_HEIGHT = 380;
const TASKBAR_MARGIN = 50; // Pixels from bottom/right edges

// --- PERSISTED TAMAGOTCHI CARE STATS ---
let stats = {
  energy: 85,
  affection: 70,
  intellect: 45
};

// Load saved stats from localStorage if available
if (localStorage.getItem('pico_stats')) {
  try {
    stats = JSON.parse(localStorage.getItem('pico_stats'));
  } catch (e) {
    console.error('Failed to parse saved stats, using defaults');
  }
}

function saveStats() {
  localStorage.setItem('pico_stats', JSON.stringify(stats));
  updateStatsUI();
}

function updateStatsUI() {
  // Clamp stats between 0 and 100
  stats.energy = Math.max(0, Math.min(100, stats.energy));
  stats.affection = Math.max(0, Math.min(100, stats.affection));
  stats.intellect = Math.max(0, Math.min(100, stats.intellect));

  document.getElementById('stat-energy').style.width = `${stats.energy}%`;
  document.getElementById('stat-affection').style.width = `${stats.affection}%`;
  document.getElementById('stat-intellect').style.width = `${stats.intellect}%`;
}

// Slowly drain energy over time, but sleep mode restores it!
setInterval(() => {
  const pet = document.getElementById('pixel-pet');
  if (pet.classList.contains('sleeping')) {
    stats.energy = Math.min(100, stats.energy + 2);
  } else {
    stats.energy = Math.max(0, stats.energy - 0.2);
  }
  saveStats();
}, 5000);

// --- COMPACT / EXPANDED STATE TOGGLING ---
let isPanelOpen = true; // Start open to show off the controls!

function togglePanel(forceState) {
  if (forceState !== undefined) {
    isPanelOpen = forceState;
  } else {
    isPanelOpen = !isPanelOpen;
  }

  const assistantPanel = document.getElementById('assistant-panel');
  if (isPanelOpen) {
    assistantPanel.style.display = 'flex';
    ipcRenderer.send('window-resize', { width: EXPANDED_WIDTH, height: WINDOW_HEIGHT });
  } else {
    assistantPanel.style.display = 'none';
    ipcRenderer.send('window-resize', { width: COMPACT_WIDTH, height: WINDOW_HEIGHT });
  }
  
  // Snap/Animate window position to align with bottom-right resting state
  triggerGravityFall();
}

// --- MICRO-INTERACTION: PETTING ---
function petPico() {
  stats.affection = Math.min(100, stats.affection + 5);
  saveStats();
  
  setPetState('happy');
  speakBubble("Hehe! That tickles! You're doing an amazing job, Varshan! 💖");
  speak("Hehe! That tickles! You're doing an amazing job, Varshan!");
  
  setTimeout(() => {
    restorePetState();
  }, 3000);
}

// --- VOICE SYNTHESIS (TTS) ---
let synth = window.speechSynthesis;
let voices = [];
let selectedVoice = null;
let mouthInterval = null;

function populateVoiceList() {
  voices = synth.getVoices();
  const voiceSelect = document.getElementById('voice-select');
  voiceSelect.innerHTML = '';

  // Select suitable English voices
  const enVoices = voices.filter(v => v.lang.startsWith('en'));
  const listToUse = enVoices.length > 0 ? enVoices : voices;

  listToUse.forEach((voice, index) => {
    const option = document.createElement('option');
    option.textContent = `${voice.name} (${voice.lang})`;
    option.value = index;
    // Prefer Microsoft Zira (cute female) or David, or Google US English
    if (voice.name.includes('Zira') || voice.name.includes('Google US English') || voice.name.includes('David')) {
      option.selected = true;
      selectedVoice = voice;
    }
    voiceSelect.appendChild(option);
  });

  if (!selectedVoice && listToUse.length > 0) {
    selectedVoice = listToUse[0];
  }
}

// Chromiums voices are loaded asynchronously
if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = populateVoiceList;
} else {
  populateVoiceList();
}

document.getElementById('voice-select').addEventListener('change', (e) => {
  selectedVoice = voices[e.target.value];
});

function speak(text) {
  if (!text) return;
  synth.cancel(); // Stop talking if already talking

  const utterance = new SpeechSynthesisUtterance(text);
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }
  // Custom cute adjustments: slightly higher pitch for friendly companion pet tone!
  utterance.pitch = 1.15; 
  utterance.rate = 1.05;

  // Animate mouth during talking
  utterance.onstart = () => {
    const mouth = document.querySelector('.mouth');
    if (mouthInterval) clearInterval(mouthInterval);
    mouthInterval = setInterval(() => {
      mouth.style.height = mouth.style.height === '8px' ? '2px' : '8px';
      mouth.style.borderRadius = mouth.style.height === '8px' ? '50%' : '0 0 4px 4px';
    }, 150);
  };

  utterance.onend = () => {
    if (mouthInterval) {
      clearInterval(mouthInterval);
      mouthInterval = null;
    }
    const mouth = document.querySelector('.mouth');
    mouth.style.height = '4px';
    mouth.style.borderRadius = '0 0 4px 4px';
  };

  utterance.onerror = () => {
    if (mouthInterval) {
      clearInterval(mouthInterval);
      mouthInterval = null;
    }
  };

  synth.speak(utterance);
}

// --- VOICE RECOGNITION (STT) ---
let recognition = null;
let isListening = false;

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRecognitionObj = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognitionObj();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isListening = true;
    document.getElementById('btn-voice').classList.add('listening');
    document.getElementById('transcribing-indicator').style.display = 'block';
    document.getElementById('speech-text').style.display = 'none';
    document.getElementById('speech-bubble').classList.add('active');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    document.getElementById('chat-input').value = transcript;
    
    // Auto-submit voice command!
    handleSendMessage(transcript);
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error', event.error);
    stopListening();
  };

  recognition.onend = () => {
    stopListening();
  };
} else {
  console.warn('Speech Recognition not supported in this browser.');
  document.getElementById('btn-voice').style.display = 'none';
}

function stopListening() {
  isListening = false;
  document.getElementById('btn-voice').classList.remove('listening');
  document.getElementById('transcribing-indicator').style.display = 'none';
  document.getElementById('speech-text').style.display = 'block';
}

function toggleListening() {
  if (!recognition) return;
  if (isListening) {
    recognition.stop();
  } else {
    recognition.start();
  }
}

document.getElementById('btn-voice').addEventListener('click', (e) => {
  e.stopPropagation(); // Avoid collapsing/toggling assistant panel
  toggleListening();
});

// --- AI CHAT & SYSTEM ROUTING ENGINE ---
let chatHistory = [];
let currentActiveWindow = 'Desktop';
let previousPetState = 'idle';

function setPetState(state) {
  const pet = document.getElementById('pixel-pet');
  
  // Remove standard state classes
  pet.classList.remove('idle', 'happy', 'coding', 'studying', 'sleeping');
  pet.classList.add(state);
}

function restorePetState() {
  const pet = document.getElementById('pixel-pet');
  pet.classList.remove('idle', 'happy', 'coding', 'studying', 'sleeping');
  pet.classList.add(previousPetState);
}

function speakBubble(text) {
  const speechBubble = document.getElementById('speech-bubble');
  const speechText = document.getElementById('speech-text');
  
  speechText.textContent = text;
  speechBubble.classList.add('active');
  
  // Hide bubble after 8 seconds of inactivity unless speaking is active
  setTimeout(() => {
    if (!synth.speaking && speechText.textContent === text) {
      speechBubble.classList.remove('active');
    }
  }, 8000);
}

async function handleSendMessage(customText) {
  const inputEl = document.getElementById('chat-input');
  const message = (customText || inputEl.value).trim();
  if (!message) return;

  inputEl.value = '';
  
  // Show thinking state
  setPetState('coding'); // Code thinking cap!
  speakBubble("Let me process that, Varshan...");

  // Send request to main process Gemini API
  const response = await ipcRenderer.invoke('ai-chat', {
    userMessage: message,
    chatHistory: chatHistory,
    activeWindow: currentActiveWindow
  });

  if (!response.success) {
    setPetState('idle');
    speakBubble(`Error: ${response.error}`);
    speak("Oops! I had a connection glitch. Check your API key!");
    return;
  }

  // Update chat history
  chatHistory.push({ role: 'user', content: message });
  chatHistory.push({ role: 'model', content: response.speech });
  if (chatHistory.length > 10) chatHistory.shift(); // Keep history size small

  // Process animation
  let targetAnim = response.animation || 'idle';
  previousPetState = targetAnim;
  setPetState(targetAnim);

  // Update UI bubble
  speakBubble(response.speech);
  
  // Speak out-loud!
  speak(response.speech);

  // Trigger Local OS Automations
  if (response.action && response.action !== 'none') {
    if (response.action === 'start_pomodoro') {
      const mins = parseInt(response.param, 10) || 25;
      startPomodoro(mins);
      stats.intellect = Math.min(100, stats.intellect + 4);
      stats.energy = Math.max(0, stats.energy - 5);
      saveStats();
    } else {
      // General OS execute
      const execResult = await ipcRenderer.invoke('system-execute', {
        action: response.action,
        param: response.param
      });
      
      if (execResult.success) {
        // Boost stats accordingly
        if (response.action === 'git_sync') {
          stats.intellect = Math.min(100, stats.intellect + 5);
          speakBubble("Sync complete! Code pushed safely to GitHub!");
          speak("Sync complete! Code pushed safely to GitHub!");
        } else if (response.action === 'sys_info') {
          const ram = execResult.data;
          const ramMsg = `System Memory is currently at ${ram.percent}% usage. You have ${Math.round(ram.freeKB / 1024 / 1024)} GB of RAM free.`;
          speakBubble(ramMsg);
          speak(ramMsg);
        } else if (response.action === 'launch_app' || response.action === 'open_url') {
          stats.intellect = Math.min(100, stats.intellect + 3);
          stats.energy = Math.max(0, stats.energy - 8);
        }
        saveStats();
      } else {
        speakBubble(`Failed to execute system command: ${execResult.error}`);
        speak("I ran into an issue launching that app.");
      }
    }
  } else {
    // Normal conversation adds affection!
    stats.affection = Math.min(100, stats.affection + 2);
    saveStats();
  }
}

document.getElementById('btn-send').addEventListener('click', () => handleSendMessage());
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSendMessage();
});

// --- POMODORO TIMER WORKFLOW ---
let pomodoroTimer = null;
let pTimeRemaining = 0;
let isDistractionWarningActive = false;

function startPomodoro(minutes) {
  if (pomodoroTimer) clearInterval(pomodoroTimer);
  
  pTimeRemaining = minutes * 60;
  const overlay = document.getElementById('timer-overlay');
  const clock = document.getElementById('timer-clock');
  
  overlay.classList.add('active');
  setPetState('studying');
  previousPetState = 'studying';
  
  pomodoroTimer = setInterval(() => {
    pTimeRemaining--;
    
    if (pTimeRemaining <= 0) {
      clearInterval(pomodoroTimer);
      pomodoroTimer = null;
      overlay.classList.remove('active');
      setPetState('happy');
      previousPetState = 'idle';
      speakBubble("Pomodoro session completed! Incredible job, Varshan! Take a break! 🎉");
      speak("Pomodoro session completed! Incredible job, Varshan! Take a break!");
      
      // Update stats
      stats.intellect = Math.min(100, stats.intellect + 15);
      saveStats();
      return;
    }
    
    // Format minutes and seconds
    const mins = Math.floor(pTimeRemaining / 60);
    const secs = pTimeRemaining % 60;
    clock.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, 1000);
}

// --- ACTIVE SCREEN SCANNER & ANTI-SLACK ALERTS ---
const DISTRACTING_KEYWORDS = ['youtube', 'twitter', 'x.com', 'facebook', 'reddit', 'discord', 'netflix', 'roblox', 'steam', 'game'];

ipcRenderer.on('active-window', (event, title) => {
  currentActiveWindow = title;
  const statusMsg = document.getElementById('status-msg');
  statusMsg.textContent = `Watching: ${title}`;

  // If a Pomodoro study timer is running, check for distractions!
  if (pomodoroTimer && !isDistractionWarningActive) {
    const titleLower = title.toLowerCase();
    
    // Verify it is a true distraction (ignore Lofi/music tabs if they are playing study music)
    const isDistracted = DISTRACTING_KEYWORDS.some(keyword => {
      // If it's YouTube but we are on the study music stream, it is allowed!
      if (keyword === 'youtube' && (titleLower.includes('lofi') || titleLower.includes('chill') || titleLower.includes('study'))) {
        return false;
      }
      return titleLower.includes(keyword);
    });

    if (isDistracted) {
      isDistractionWarningActive = true;
      
      setPetState('happy'); // Flash pet attention
      speakBubble("Hey Varshan! Let's get back to work! Studying mode is active! 📚");
      speak("Hey Varshan! Let's get back to work! Studying mode is active!");
      
      // Prevent rapid spam alert triggers
      setTimeout(() => {
        isDistractionWarningActive = false;
      }, 15000);
    }
  }
});

// --- CUSTOM JS PHYSICS DRAG SYSTEM ---
let isDragging = false;
let startX = 0;
let startY = 0;
let initialWindowX = 0;
let initialWindowY = 0;
let gravityInterval = null;

const dragElement = document.getElementById('drag-handle');
const avatarContainer = document.getElementById('avatar-container');

function initDrag(e) {
  isDragging = true;
  if (gravityInterval) {
    clearInterval(gravityInterval);
    gravityInterval = null;
  }
  
  startX = e.screenX;
  startY = e.screenY;
  initialWindowX = window.screenX;
  initialWindowY = window.screenY;

  window.addEventListener('mousemove', dragMove);
  window.addEventListener('mouseup', dragEnd);
}

function dragMove(e) {
  if (!isDragging) return;
  
  const deltaX = e.screenX - startX;
  const deltaY = e.screenY - startY;
  
  const newX = initialWindowX + deltaX;
  const newY = initialWindowY + deltaY;
  
  ipcRenderer.send('window-move', { x: newX, y: newY });
}

function dragEnd() {
  if (!isDragging) return;
  isDragging = false;
  
  window.removeEventListener('mousemove', dragMove);
  window.removeEventListener('mouseup', dragEnd);

  // Trigger Gravity fall to return pet safely home to taskbar!
  triggerGravityFall();
}

dragElement.addEventListener('mousedown', initDrag);
avatarContainer.addEventListener('mousedown', (e) => {
  // Only trigger dragging if not clicking the actual buttons, microphone, or text inputs
  if (e.target.closest('#btn-voice') || e.target.closest('#timer-overlay')) return;
  initDrag(e);
});

// Double click pet container to collapse/expand panel!
avatarContainer.addEventListener('dblclick', (e) => {
  if (e.target.closest('#btn-voice') || e.target.closest('#timer-overlay')) return;
  togglePanel();
});

// Click pet to pet it!
document.getElementById('pixel-pet').addEventListener('click', (e) => {
  e.stopPropagation(); // Avoid double click triggers
  petPico();
});

// --- GRAVITY SIMULATION ENGINE ---
function triggerGravityFall() {
  if (gravityInterval) clearInterval(gravityInterval);
  
  // Target position is bottom right just above taskbar
  const restingWidth = isPanelOpen ? EXPANDED_WIDTH : COMPACT_WIDTH;
  const targetX = screen.availWidth - restingWidth - 20;
  const targetY = screen.availHeight - WINDOW_HEIGHT - TASKBAR_MARGIN;

  let currentX = window.screenX;
  let currentY = window.screenY;

  // Spring & Gravity physics factors
  const speedFactor = 0.15;

  gravityInterval = setInterval(() => {
    const diffX = targetX - currentX;
    const diffY = targetY - currentY;

    if (Math.abs(diffX) < 1 && Math.abs(diffY) < 1) {
      clearInterval(gravityInterval);
      gravityInterval = null;
      ipcRenderer.send('window-move', { x: targetX, y: targetY });
    } else {
      currentX += diffX * speedFactor;
      currentY += diffY * speedFactor;
      
      ipcRenderer.send('window-move', { x: Math.round(currentX), y: Math.round(currentY) });
    }
  }, 16); // ~60fps
}

// --- WINDOW CONTROLS BINDINGS ---
document.getElementById('btn-min').addEventListener('click', () => {
  ipcRenderer.send('window-minimize');
});

document.getElementById('btn-close').addEventListener('click', () => {
  ipcRenderer.send('window-close');
});

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
  // Initialize Stats UI
  updateStatsUI();
  
  // Set starting position at resting coordinates
  const targetX = screen.availWidth - EXPANDED_WIDTH - 20;
  const targetY = screen.availHeight - WINDOW_HEIGHT - TASKBAR_MARGIN;
  ipcRenderer.send('window-move', { x: targetX, y: targetY });

  // Warm voice welcome
  setTimeout(() => {
    speakBubble("Hello Varshan! I'm Pico, your care pet and desktop helper! Let's crush our goals today! 🚀");
    speak("Hello Varshan! I'm Pico, your care pet and desktop helper! Let's crush our goals today!");
  }, 1000);
});
