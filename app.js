// Supabase Setup
const SUPABASE_URL = 'https://csluiwfzgtxuodfffinf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzbHVpd2Z6Z3R4dW9kZmZmaW5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQzNTMwODEsImV4cCI6MjA1OTkyOTA4MX0.XCGYf5q7QD57K8-wf0Pm8BzjdsT2sIWQSMQbAbtn5ss';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Individual API Endpoints
const API_ENDPOINTS = {
  FACE_MATCH: 'https://e466-35-199-182-48.ngrok-free.app/faceMatch',
  PREDICT_DISEASE: 'https://a5b3-34-71-41-238.ngrok-free.app/predictDisease',
  ADD_PATIENT: 'https://e530-35-236-158-52.ngrok-free.app/addPatient'
};

// DOM Elements
const loginSection = document.getElementById('auth-container');
const dashboardSection = document.getElementById('dashboard-container');
const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const userEmailSpan = document.getElementById('user-email');
const logoutBtn = document.getElementById('logout-btn');
const patientsList = document.getElementById('patients-table-body');
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const captureBtn = document.getElementById('capture-btn');
const resetCameraBtn = document.getElementById('reset-camera-btn');
const scanResult = document.getElementById('match-result');
const patientNameInput = document.getElementById('patient-name');
const newPatientForm = document.getElementById('new-patient-form');
const saveNewPatientBtn = document.getElementById('save-new-patient');
const notification = document.getElementById('notification');
const patientsTab = document.getElementById('patients-tab');
const scanTab = document.getElementById('scan-tab');
const patientsView = document.getElementById('patients-view');
const scanView = document.getElementById('scan-view');
const addPatientBtn = document.getElementById('add-patient-btn');

let currentDoctor = null;
let videoStream = null;
let capturedImageBase64 = null;

// Utility Functions
function showNotification(message, isError = false) {
  notification.textContent = message;
  notification.className = isError ? 'alert alert-danger' : 'alert alert-success';
  notification.style.display = 'block';
  setTimeout(() => (notification.style.display = 'none'), 5000);
}

// Enhanced API Caller for Multiple Endpoints
async function callApi(endpoint, body, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    console.log(`Calling ${endpoint} with:`, { 
      ...body, 
      image_base64: body.image_base64 ? '[truncated]' : undefined 
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        ...options.headers
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await parseResponse(response);
      throw new Error(errorData.message || `API error: ${response.status}`);
    }

    return await parseResponse(response);
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`API call to ${endpoint} failed:`, error);
    throw normalizeApiError(error);
  }
}

async function parseResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (e) {
    console.error('Failed to parse JSON:', text);
    return { message: text };
  }
}

function normalizeApiError(error) {
  if (error.name === 'AbortError') {
    return new Error('Request timed out. Please try again.');
  }
  return error.message.includes('Failed to fetch') 
    ? new Error('Network error. Check your connection.') 
    : error;
}

// Auth Functions
async function checkAuth() {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    
    if (user) {
      currentDoctor = user;
      userEmailSpan.textContent = user.email;
      loginSection.classList.add('d-none');
      dashboardSection.classList.remove('d-none');
      fetchPatients();
    } else {
      loginSection.classList.remove('d-none');
      dashboardSection.classList.add('d-none');
    }
  } catch (err) {
    console.error('Auth error:', err);
    showNotification('Session error. Please refresh.', true);
  }
}

// Patient Functions
async function fetchPatients() {
  try {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('doctor_id', currentDoctor.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    patientsList.innerHTML = data.length ? '' : '<li class="list-group-item">No patients found</li>';
    
    data.forEach(p => {
      const row = document.createElement('li');
      row.className = 'list-group-item';
      row.innerHTML = `
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <strong>${p.name}</strong> - ${p.disease_detected || 'No diagnosis'}
            ${p.diagnosis_confidence ? `(Confidence: ${(p.diagnosis_confidence * 100).toFixed(2)}%)` : ''}
          </div>
          <small class="text-muted">${new Date(p.created_at).toLocaleDateString()}</small>
        </div>
      `;
      patientsList.appendChild(row);
    });
  } catch (err) {
    console.error('Fetch patients error:', err);
    showNotification('Failed to load patients', true);
  }
}

// Camera Functions
async function startCamera() {
  stopCamera();
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user' 
      } 
    });
    video.srcObject = videoStream;
    video.classList.remove('d-none');
    canvas.classList.add('d-none');
    scanResult.innerHTML = '';
    newPatientForm.classList.add('d-none');
  } catch (err) {
    console.error('Camera error:', err);
    showNotification('Camera access denied. Please enable permissions.', true);
  }
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
    videoStream = null;
  }
}

// Image Processing
async function processCapturedImage() {
  if (!capturedImageBase64) {
    showNotification('No image captured', true);
    return;
  }

  try {
    showNotification('Analyzing image...', false);
    
    // Try disease detection first
    const diseaseResponse = await callApi(API_ENDPOINTS.PREDICT_DISEASE, {
      image_base64: capturedImageBase64,
      doctor_id: currentDoctor.id
    });

    if (diseaseResponse.disease) {
      showResult({
        type: 'disease',
        disease: diseaseResponse.disease,
        confidence: diseaseResponse.confidence
      });
      return;
    }

    // Fallback to face matching
    const matchResponse = await callApi(API_ENDPOINTS.FACE_MATCH, {
      image_base64: capturedImageBase64
    });

    if (matchResponse.match) {
      const patient = await getPatientById(matchResponse.patient_id);
      if (patient) {
        showResult({
          type: 'patient',
          patient
        });
        return;
      }
    }

    throw new Error('No match found. Register as new patient.');
    
  } catch (error) {
    console.error('Processing error:', error);
    showResult({
      type: 'error',
      message: error.message
    });
  }
}

async function getPatientById(patientId) {
  try {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('id', patientId)
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Patient lookup error:', err);
    return null;
  }
}

function showResult({ type, disease, confidence, patient, message }) {
  switch (type) {
    case 'disease':
      scanResult.innerHTML = `
        <div class="alert alert-info">
          <h5>Diagnosis Result</h5>
          <p><strong>Condition:</strong> ${disease}</p>
          <p><strong>Confidence:</strong> ${(confidence * 100).toFixed(2)}%</p>
        </div>`;
      newPatientForm.classList.remove('d-none');
      break;
      
    case 'patient':
      scanResult.innerHTML = `
        <div class="alert alert-success">
          <h5>Patient Recognized</h5>
          <p><strong>Name:</strong> ${patient.name}</p>
          ${patient.disease_detected ? `
            <p><strong>Previous Diagnosis:</strong> ${patient.disease_detected}</p>
            <p><strong>Confidence:</strong> ${(patient.diagnosis_confidence * 100).toFixed(2)}%</p>
          ` : ''}
        </div>`;
      newPatientForm.classList.add('d-none');
      break;
      
    case 'error':
      scanResult.innerHTML = `
        <div class="alert alert-danger">
          <h5>Analysis Failed</h5>
          <p>${message || 'Unknown error occurred'}</p>
          <p>Please try again with a clearer image.</p>
        </div>`;
      newPatientForm.classList.add('d-none');
      break;
  }
}

// Event Listeners
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value.trim()
    });
    if (error) throw error;
    
    currentDoctor = data.user;
    userEmailSpan.textContent = currentDoctor.email;
    loginSection.classList.add('d-none');
    dashboardSection.classList.remove('d-none');
    fetchPatients();
  } catch (err) {
    console.error('Login error:', err);
    showNotification('Login failed: ' + err.message, true);
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    
    currentDoctor = null;
    loginSection.classList.remove('d-none');
    dashboardSection.classList.add('d-none');
  } catch (err) {
    console.error('Logout error:', err);
    showNotification('Logout failed: ' + err.message, true);
  }
});

captureBtn.addEventListener('click', () => {
  try {
    if (!videoStream) throw new Error('Camera not ready');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    capturedImageBase64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    video.classList.add('d-none');
    canvas.classList.remove('d-none');
    processCapturedImage();
  } catch (err) {
    console.error('Capture error:', err);
    showNotification(err.message, true);
  }
});

resetCameraBtn.addEventListener('click', () => {
  try {
    capturedImageBase64 = null;
    patientNameInput.value = '';
    startCamera();
  } catch (err) {
    console.error('Reset error:', err);
    showNotification('Failed to reset camera', true);
  }
});

saveNewPatientBtn.addEventListener('click', async () => {
  try {
    const name = patientNameInput.value.trim();
    if (!name) throw new Error('Patient name required');

    showNotification('Saving patient...', false);
    
    const result = await callApi(API_ENDPOINTS.ADD_PATIENT, {
      name,
      doctor_id: currentDoctor.id,
      image_base64: capturedImageBase64
    });

    if (!result.patient_id) throw new Error(result.message || 'Save failed');
    
    showNotification('Patient saved!');
    fetchPatients();
    resetCameraBtn.click();
  } catch (error) {
    console.error('Save error:', error);
    showNotification('Save failed: ' + error.message, true);
  }
});

// Tab Navigation
patientsTab.addEventListener('click', (e) => {
  e.preventDefault();
  patientsTab.classList.add('active');
  scanTab.classList.remove('active');
  patientsView.classList.remove('d-none');
  scanView.classList.add('d-none');
  stopCamera();
});

scanTab.addEventListener('click', (e) => {
  e.preventDefault();
  scanTab.classList.add('active');
  patientsTab.classList.remove('active');
  scanView.classList.remove('d-none');
  patientsView.classList.add('d-none');
  startCamera();
});

addPatientBtn.addEventListener('click', (e) => {
  e.preventDefault();
  scanTab.click();
});

// Initialize
window.addEventListener('load', checkAuth);
