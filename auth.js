/* ============================================================
   AZERO GFX — Account signup / login module
   ============================================================
   Add to your <head>, after order-chat.js:
     <script type="module" src="auth.js"></script>

   Requires the same Firebase project as order-chat.js — no
   extra setup beyond what's already in PATCH-INSTRUCTIONS.md,
   except: Firebase Console > Authentication > Sign-in method >
   enable "Email/Password".
   ============================================================ */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Reuses the same config you already pasted into order-chat.js.
// Duplicated here on purpose — modules don't share scope, and this
// keeps auth.js usable on its own if you ever split pages.
const FIREBASE_CONFIG = {
apiKey: "AIzaSyCXyemHrPApcIwYDW-ZLjtoUhFEk-t0Huk",
authDomain: "website-test-64cac.firebaseapp.com",
projectId: "website-test-64cac",
storageBucket: "website-test-64cac.firebasestorage.app",
messagingSenderId: "512176077221",
appId: "1:512176077221:web:3d23bf04cecedafa03904c",
};

const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);

// Same guard as order-chat.js — only one of the two files should actually
// call connectAuthEmulator, since they share the same Auth instance when
// both are loaded on the same page (order-chat.js normally runs first).
if (["localhost", "127.0.0.1"].includes(location.hostname) && !self.__azeroEmulatorsConnected) {
  connectAuthEmulator(auth, "http://localhost:9099");
  self.__azeroEmulatorsConnected = true;
}

let currentUser = null;

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  renderAuthUI();
  document.dispatchEvent(new CustomEvent("azero-auth-changed", { detail: { user } }));
});

function renderAuthUI() {
  const slot = document.getElementById("azero-auth-slot");
  if (!slot) return;

  if (currentUser) {
    slot.innerHTML = `
      <div class="flex items-center gap-3">
        <span class="text-xs text-gray-400">Hi, ${escapeHtml(currentUser.displayName || currentUser.email)}</span>
        <button id="azero-logout-btn" class="text-xs font-bold text-gray-400 hover:text-white uppercase tracking-widest">Log out</button>
      </div>
    `;
    document.getElementById("azero-logout-btn").addEventListener("click", () => signOut(auth));
  } else {
    slot.innerHTML = `
      <button id="azero-login-btn" class="bg-white/5 border border-white/10 px-5 py-2.5 rounded-full text-xs font-bold text-white uppercase tracking-widest hover:bg-white/10">Log in / Sign up</button>
    `;
    document.getElementById("azero-login-btn").addEventListener("click", openAuthModal);
  }
}

function openAuthModal() {
  let modal = document.getElementById("azero-auth-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "azero-auth-modal";
    modal.className = "fixed inset-0 z-[300] flex items-center justify-center px-4";
    modal.innerHTML = `
      <div class="absolute inset-0 bg-black/90 backdrop-blur-md" data-close></div>
      <div class="relative w-full max-w-md bg-[#0a0a0a] border border-white/10 rounded-3xl p-8">
        <div class="flex mb-6 bg-white/5 rounded-xl p-1">
          <button id="azero-tab-login" class="flex-1 py-2.5 rounded-lg bg-brand text-white text-xs font-black uppercase">Log In</button>
          <button id="azero-tab-signup" class="flex-1 py-2.5 rounded-lg text-gray-400 text-xs font-black uppercase">Sign Up</button>
        </div>
        <div id="azero-auth-error" class="text-red-400 text-xs mb-4 hidden"></div>
        <div class="space-y-4">
          <input id="azero-auth-name" type="text" placeholder="Your name" class="hidden w-full bg-white/[0.03] border border-white/10 rounded-xl p-4 text-white text-sm outline-none focus:border-brand">
          <input id="azero-auth-email" type="email" placeholder="Email" class="w-full bg-white/[0.03] border border-white/10 rounded-xl p-4 text-white text-sm outline-none focus:border-brand">
          <input id="azero-auth-password" type="password" placeholder="Password" class="w-full bg-white/[0.03] border border-white/10 rounded-xl p-4 text-white text-sm outline-none focus:border-brand">
        </div>
        <button id="azero-auth-submit" class="w-full bg-brand mt-6 py-4 rounded-xl text-white font-black text-xs uppercase tracking-widest">Log In</button>
        <button class="w-full mt-3 text-gray-500 text-xs font-bold uppercase" data-close>Cancel</button>
      </div>
    `;
    document.body.appendChild(modal);

    let mode = "login";
    const nameInput = modal.querySelector("#azero-auth-name");
    const submitBtn = modal.querySelector("#azero-auth-submit");
    const errorBox = modal.querySelector("#azero-auth-error");
    const tabLogin = modal.querySelector("#azero-tab-login");
    const tabSignup = modal.querySelector("#azero-tab-signup");

    function setMode(newMode) {
      mode = newMode;
      errorBox.classList.add("hidden");
      if (mode === "login") {
        tabLogin.className = "flex-1 py-2.5 rounded-lg bg-brand text-white text-xs font-black uppercase";
        tabSignup.className = "flex-1 py-2.5 rounded-lg text-gray-400 text-xs font-black uppercase";
        nameInput.classList.add("hidden");
        submitBtn.innerText = "Log In";
      } else {
        tabSignup.className = "flex-1 py-2.5 rounded-lg bg-brand text-white text-xs font-black uppercase";
        tabLogin.className = "flex-1 py-2.5 rounded-lg text-gray-400 text-xs font-black uppercase";
        nameInput.classList.remove("hidden");
        submitBtn.innerText = "Sign Up";
      }
    }

    tabLogin.addEventListener("click", () => setMode("login"));
    tabSignup.addEventListener("click", () => setMode("signup"));
    modal.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", () => modal.classList.add("hidden")));

    submitBtn.addEventListener("click", async () => {
      const email = modal.querySelector("#azero-auth-email").value.trim();
      const password = modal.querySelector("#azero-auth-password").value;
      const name = nameInput.value.trim();
      errorBox.classList.add("hidden");

      try {
        if (mode === "signup") {
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          if (name) await updateProfile(cred.user, { displayName: name });
        } else {
          await signInWithEmailAndPassword(auth, email, password);
        }
        modal.classList.add("hidden");
      } catch (e) {
        errorBox.innerText = friendlyAuthError(e.code);
        errorBox.classList.remove("hidden");
      }
    });
  }
  modal.classList.remove("hidden");
}

function friendlyAuthError(code) {
  const map = {
    "auth/email-already-in-use": "That email already has an account — try logging in instead.",
    "auth/invalid-email": "That email doesn't look right.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/wrong-password": "Wrong password.",
    "auth/user-not-found": "No account with that email — try signing up."
  };
  return map[code] || "Something went wrong. Try again.";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.innerText = str;
  return div.innerHTML;
}

window.azeroAuth = {
  getCurrentUser: () => currentUser,
  openAuthModal
};
