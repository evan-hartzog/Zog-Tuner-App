const startButton = document.getElementById("start-button");
const stopButton = document.getElementById("stop-button");
const statusText = document.getElementById("status");
const noteText = document.getElementById("note");
const targetNoteText = document.getElementById("target-note");
const frequencyText = document.getElementById("frequency");
const centsText = document.getElementById("cents");
const guidanceText = document.getElementById("guidance");
const needle = document.getElementById("needle");
const tunerCard = document.getElementById("tuner-card");

let stream = null;
let animationFrameId = null;
let audioContext = null;
let analyser = null;
let microphone = null;
let dataArray = null;
let isRunning = false;
let smoothedFrequency = null;
let stableTarget = null;
let stableCounter = 0;

const guitarStrings = [
    { note: "E2", freq: 82.41 },
    { note: "A2", freq: 110.00 },
    { note: "D3", freq: 146.83 },
    { note: "G3", freq: 196.00 },
    { note: "B3", freq: 246.94 },
    { note: "E4", freq: 329.63 }
];

startButton.addEventListener("click", startTuner);
stopButton.addEventListener("click", stopTuner);

async function startTuner() {
    if (isRunning) return;

    try {
        statusText.textContent = "Status: requesting microphone access...";
        guidanceText.textContent = "Allow microphone access to begin tuning.";

        stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            },
            video: false
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;

        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);

        dataArray = new Float32Array(analyser.fftSize);

        isRunning = true;
        statusText.textContent = "Status: microphone active";
        guidanceText.textContent = "Play one string clearly.";
        startButton.disabled = true;
        stopButton.disabled = false;

        detectPitch();
    } catch (error) {
        statusText.textContent = `Status: microphone access failed (${error.name})`;

        if (error.name === "NotAllowedError") {
            guidanceText.textContent = "Microphone permission was denied.";
        } else if (error.name === "NotFoundError") {
            guidanceText.textContent = "No microphone was found.";
        } else if (error.name === "NotReadableError") {
            guidanceText.textContent = "Microphone is busy or unavailable.";
        } else if (error.name === "AbortError") {
            guidanceText.textContent = "Microphone startup was interrupted.";
        } else {
            guidanceText.textContent = `Microphone error: ${error.name}`;
        }

        console.error(error);
        await cleanupAudio();
        startButton.disabled = false;
        stopButton.disabled = true;
    }
}

async function stopTuner() {
    if (!isRunning) return;

    isRunning = false;
    statusText.textContent = "Status: tuner stopped";
    guidanceText.textContent = "Tuner stopped.";

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    await cleanupAudio();

    startButton.disabled = false;
    stopButton.disabled = true;
    resetDisplay();
}

async function cleanupAudio() {
    if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
    }

    if (microphone) {
        try {
            microphone.disconnect();
        } catch (error) {
            console.error(error);
        }
        microphone = null;
    }

    if (audioContext) {
        try {
            await audioContext.close();
        } catch (error) {
            console.error(error);
        }
        audioContext = null;
    }

    analyser = null;
    dataArray = null;
    smoothedFrequency = null;
    stableTarget = null;
    stableCounter = 0;
}

function detectPitch() {
    if (!isRunning || !analyser || !audioContext || !dataArray) {
        return;
    }

    analyser.getFloatTimeDomainData(dataArray);

    const detectedFrequency = autoCorrelate(dataArray, audioContext.sampleRate);

    if (detectedFrequency !== -1) {
        if (smoothedFrequency === null) {
            smoothedFrequency = detectedFrequency;
        } else {
            smoothedFrequency = (smoothedFrequency * 0.82) + (detectedFrequency * 0.18);
        }

        const nearest = getNearestString(smoothedFrequency);
        const target = getStableTarget(nearest);
        const cents = getCents(smoothedFrequency, target.freq);

        updateDisplay(smoothedFrequency, target, cents);
    } else {
        resetDisplay(false);
    }

    animationFrameId = requestAnimationFrame(detectPitch);
}

function updateDisplay(freq, target, cents) {
    const absCents = Math.abs(cents);
    const clampedCents = Math.max(-50, Math.min(50, cents));
    const needlePercent = ((clampedCents + 50) / 100) * 100;

    noteText.textContent = target.note;
    targetNoteText.textContent = `Target string: ${target.note} (${target.freq.toFixed(2)} Hz)`;
    frequencyText.textContent = `${freq.toFixed(2)} Hz`;
    centsText.textContent = `${cents > 0 ? "+" : ""}${cents.toFixed(1)}¢`;
    needle.style.left = `${needlePercent}%`;

    tunerCard.classList.remove("state-flat", "state-sharp", "state-close", "state-in-tune");

    if (absCents <= 5) {
        guidanceText.textContent = "In tune";
        tunerCard.classList.add("state-in-tune");
    } else if (absCents <= 15) {
        guidanceText.textContent = cents < 6 ? "Slightly flat" : "Slightly sharp";
        tunerCard.classList.add("state-close");
    } else if (cents < 0) {
        guidanceText.textContent = "Tune up";
        tunerCard.classList.add("state-flat");
    } else {
        guidanceText.textContent = "Tune down";
        tunerCard.classList.add("state-sharp");
    }
}

function resetDisplay(resetStatus = true) {
    smoothedFrequency = null;
    stableTarget = null;
    stableCounter = 0;
    noteText.textContent = "--";
    targetNoteText.textContent = "Target string: --";
    frequencyText.textContent = "-- Hz";
    centsText.textContent = "--";
    needle.style.left = "50%";
    tunerCard.classList.remove("state-flat", "state-sharp", "state-close", "state-in-tune");

    if (resetStatus) {
        guidanceText.textContent = "Play one string clearly.";
    }
}

function getStableTarget(candidate) {
    if (!stableTarget) {
        stableTarget = candidate;
        return stableTarget;
    }

    if (stableTarget.note !== candidate.note) {
        stableCounter += 1;
        if (stableCounter >= 3) {
            stableTarget = candidate;
            stableCounter = 0;
        }
    } else {
        stableCounter = 0;
    }

    return stableTarget;
}

function getNearestString(freq) {
    let closest = guitarStrings[0];
    let minDiff = Math.abs(freq - closest.freq);

    for (const string of guitarStrings) {
        const diff = Math.abs(freq - string.freq);
        if (diff < minDiff) {
            minDiff = diff;
            closest = string;
        }
    }

    return closest;
}

function getCents(freq, refFreq) {
    return 1200 * Math.log2(freq / refFreq);
}

function autoCorrelate(buffer, sampleRate) {
    let rms = 0;

    for (let i = 0; i < buffer.length; i++) {
        rms += buffer[i] * buffer[i];
    }

    rms = Math.sqrt(rms / buffer.length);

    if (rms < 0.01) {
        return -1;
    }

    let bestOffset = -1;
    let bestCorrelation = 0;
    const maxSamples = Math.floor(buffer.length / 2);

    for (let offset = 8; offset < maxSamples; offset++) {
        let correlation = 0;

        for (let i = 0; i < maxSamples; i++) {
            correlation += Math.abs(buffer[i] - buffer[i + offset]);
        }

        correlation = 1 - (correlation / maxSamples);

        if (correlation > bestCorrelation) {
            bestCorrelation = correlation;
            bestOffset = offset;
        }
    }

    if (bestCorrelation > 0.9 && bestOffset !== -1) {
        return sampleRate / bestOffset;
    }

    return -1;
}