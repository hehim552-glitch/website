/* ============================================================
   AZERO GFX — Order + Live Chat + Payment module
   (No-Blaze version — runs entirely on Firebase's free Spark plan)
   ============================================================
   <head> setup:
     <script type="module" src="order-chat.js"></script>
     <script type="module" src="auth.js"></script>

   Needs:
   - Firestore + Authentication (Email/Password) — both free, no card
   - A free Cloudinary account for file sharing (no card) — see
     CLOUDINARY_CLOUD_NAME / CLOUDINARY_UPLOAD_PRESET below
   - Your 6 fixed-price Robux Game Passes created, IDs pasted into
     ROBLOX_PASSES below
   - Your crypto addresses pasted into CRYPTO_ADDRESSES below
   - A Discord webhook URL if you want order/message pings (optional)

   What changed from the Blaze version: payments are no longer
   auto-detected by a backend. You confirm them yourself with one
   click in admin.html after checking Roblox/your wallet — same as
   your manual process today, just built into the dashboard. The
   client-facing side (picking a method, seeing the address/link,
   live chat) is identical either way.
   ============================================================ */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy, where,
  serverTimestamp, doc, updateDoc, getDoc, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// ---- FILL IN: free Cloudinary account (cloudinary.com, no card) ----
// Dashboard home shows your "Cloud name". Create an unsigned upload
// preset at Settings > Upload > Upload presets > Add upload preset >
// Signing Mode: Unsigned > Save > copy its name.
const CLOUDINARY_CLOUD_NAME = "FILL_IN_CLOUD_NAME";
const CLOUDINARY_UPLOAD_PRESET = "FILL_IN_UPLOAD_PRESET";

// ---- FILL IN: Discord webhook (optional — leave blank to skip pings) ----
const DISCORD_WEBHOOK_URL = ""; // e.g. "https://discord.com/api/webhooks/..."

const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);

if (["localhost", "127.0.0.1"].includes(location.hostname) && !self.__azeroEmulatorsConnected) {
  connectFirestoreEmulator(db, "localhost", 8080);
  connectAuthEmulator(auth, "http://localhost:9099");
  self.__azeroEmulatorsConnected = true;
}

// ---- FILL IN: your 6 fixed-price Robux Game Passes ----
// Same pass is bought twice by a Robux-paying client — once for the
// deposit, once for the final balance — since both halves are equal.
const ROBLOX_PASSES = {
  icon_realistic:   { label: "Game Icon (Realistic)",            robux: 5000,  gamePassId: "FILL_IN_GAMEPASS_ID" },
  bundle_realistic: { label: "Thumbnail + Icon Bundle (Realistic)", robux: 10000, gamePassId: "FILL_IN_GAMEPASS_ID" },
  thumb_realistic:  { label: "Game Thumbnail (Realistic)",       robux: 7500,  gamePassId: "FILL_IN_GAMEPASS_ID" },
  icon_ctr:         { label: "Game Icon (High CTR)",             robux: 3000,  gamePassId: "FILL_IN_GAMEPASS_ID" },
  bundle_ctr:       { label: "Thumbnail + Icon Bundle (High CTR)", robux: 6500,  gamePassId: "FILL_IN_GAMEPASS_ID" },
  thumb_ctr:        { label: "Game Thumbnail (High CTR)",        robux: 5000,  gamePassId: "FILL_IN_GAMEPASS_ID" }
};

// ---- FILL IN: your wallet addresses ----
const CRYPTO_ADDRESSES = {
  LTC:         { label: "Litecoin (LTC)",        address: "FILL_IN_LTC_ADDRESS" },
  ETH:         { label: "Ethereum (ETH)",        address: "FILL_IN_ETH_ADDRESS" },
  SOL:         { label: "Solana (SOL)",          address: "FILL_IN_SOL_ADDRESS" },
  USDT_ETH:    { label: "USDT (ERC-20 / Ethereum)", address: "FILL_IN_ETH_ADDRESS", network: "Ethereum (ERC-20) — do not send on another network" },
  USDT_SOL:    { label: "USDT (SPL / Solana)",   address: "FILL_IN_SOL_ADDRESS", network: "Solana (SPL) — do not send on another network" },
  USDT_BEP20:  { label: "USDT (BEP-20 / BNB Chain)", address: "FILL_IN_BSC_ADDRESS", network: "BNB Smart Chain (BEP-20) — do not send on another network" }
};

let unsubscribeMessages = null;
let unsubscribeOrder = null;

function packageTierKey(style, packageName) {
  const styleKey = style === "ctr" ? "ctr" : "realistic";
  if (packageName.includes("Bundle")) return `bundle_${styleKey}`;
  if (packageName.includes("Thumbnail")) return `thumb_${styleKey}`;
  return `icon_${styleKey}`;
}

async function pingDiscord(content) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content })
    });
  } catch (e) { console.error("Discord ping failed:", e); }
}

/** Call this instead of copyAndOpenDiscord() at the end of Step 2/3. */
async function createOrderAndOpenChat({ name, discord, chars, desc, refs, style, pkg }) {
  const user = window.azeroAuth ? window.azeroAuth.getCurrentUser() : null;
  if (!user) {
    alert("Please log in or sign up first — it only takes a few seconds — then hit this button again.");
    if (window.azeroAuth) window.azeroAuth.openAuthModal();
    return false;
  }

  const tierKey = packageTierKey(style, pkg.name);
  const halfPrice = Math.round(pkg.priceUsd * 0.5 * 100) / 100;

  const orderRef = await addDoc(collection(db, "orders"), {
    uid: user.uid,
    clientName: name,
    clientDiscord: discord,
    clientRobloxUsername: name,
    characters: chars || "1",
    description: desc,
    references: refs || "None provided",
    style,
    package: pkg.name,
    packageTier: tierKey,
    priceUsd: pkg.priceUsd,
    depositAmountUsd: halfPrice,
    finalAmountUsd: halfPrice,
    status: "pending",
    depositStatus: "unpaid",
    finalStatus: "not_due",
    createdAt: serverTimestamp()
  });

  await addDoc(collection(db, "orders", orderRef.id, "messages"), {
    sender: "system", type: "text",
    text: `New order received: ${pkg.name} (${style}). Choose a payment method below to send your 50% deposit.`,
    createdAt: serverTimestamp()
  });

  pingDiscord(`🆕 **New order** — ${name} (Discord: ${discord || "n/a"}) ordered ${pkg.name} (${style}) — $${pkg.priceUsd}`);

  openChatUI(orderRef.id);
  return true;
}

function openChatUI(orderId) {
  const container = document.getElementById("azero-chat-container");
  if (!container) {
    console.error("Add a <div id='azero-chat-container'></div> — see PATCH-INSTRUCTIONS.md");
    return;
  }

  container.innerHTML = `
    <div id="azero-payment-panel" class="mb-4"></div>
    <div class="bg-[#111] border border-brand/20 rounded-2xl flex flex-col" style="height: 320px;">
      <div id="azero-chat-messages" class="flex-1 overflow-y-auto p-5 space-y-3 text-sm"></div>
      <div class="border-t border-white/10 p-3 flex gap-2 items-center">
        <label class="cursor-pointer text-gray-400 hover:text-brand px-2" title="Attach a file">
          📎<input id="azero-chat-file" type="file" class="hidden">
        </label>
        <input id="azero-chat-input" type="text" placeholder="Type a message..."
               class="flex-1 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-brand">
        <button id="azero-chat-send" class="bg-brand px-5 rounded-xl text-white font-black text-xs uppercase">Send</button>
      </div>
      <div id="azero-upload-status" class="hidden px-4 pb-2 text-[10px] text-gray-500"></div>
    </div>
  `;

  wireMessages(orderId);
  wireOrderStatus(orderId);
}

function renderMessage(m) {
  const mine = m.sender === "client";
  const cls = mine ? "bg-brand text-white ml-auto" : m.sender === "system" ? "bg-white/5 text-gray-400 italic mx-auto text-center" : "bg-white/10 text-white";
  if (m.type === "file") {
    const isImage = (m.fileType || "").startsWith("image/");
    return `<div class="max-w-[80%] px-3 py-3 rounded-xl ${cls}">
      ${isImage ? `<img src="${m.fileUrl}" class="rounded-lg max-h-48 mb-2">` : ""}
      <a href="${m.fileUrl}" target="_blank" class="text-xs underline break-all">${escapeHtml(m.fileName || "Download file")}</a>
    </div>`;
  }
  return `<div class="max-w-[80%] px-4 py-2.5 rounded-xl ${cls}">${escapeHtml(m.text)}</div>`;
}

async function uploadToCloudinary(file) {
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`Cloudinary upload failed (${r.status})`);
  const data = await r.json();
  return data.secure_url;
}

function wireMessages(orderId) {
  const messagesEl = document.getElementById("azero-chat-messages");
  const inputEl = document.getElementById("azero-chat-input");
  const sendBtn = document.getElementById("azero-chat-send");
  const fileEl = document.getElementById("azero-chat-file");
  const uploadStatus = document.getElementById("azero-upload-status");

  if (unsubscribeMessages) unsubscribeMessages();
  const q = query(collection(db, "orders", orderId, "messages"), orderBy("createdAt", "asc"));
  unsubscribeMessages = onSnapshot(q, (snap) => {
    messagesEl.innerHTML = snap.docs.map((d) => renderMessage(d.data())).join("");
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  async function send() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = "";
    await addDoc(collection(db, "orders", orderId, "messages"), { sender: "client", type: "text", text, createdAt: serverTimestamp() });
    const orderSnap = await getDoc(doc(db, "orders", orderId));
    pingDiscord(`💬 **${orderSnap.data()?.clientName || "A client"}**: "${text.slice(0, 200)}"`);
  }
  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });

  fileEl.addEventListener("change", async () => {
    const file = fileEl.files[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { alert("Max file size is 20MB on the free Cloudinary plan."); return; }

    uploadStatus.classList.remove("hidden");
    uploadStatus.innerText = `Uploading ${file.name}...`;
    try {
      const url = await uploadToCloudinary(file);
      await addDoc(collection(db, "orders", orderId, "messages"), {
        sender: "client", type: "file", fileUrl: url, fileName: file.name, fileType: file.type, createdAt: serverTimestamp()
      });
      uploadStatus.classList.add("hidden");
    } catch (e) {
      console.error(e);
      uploadStatus.innerText = "Upload failed — try again.";
    }
    fileEl.value = "";
  });
}

function wireOrderStatus(orderId) {
  if (unsubscribeOrder) unsubscribeOrder();
  unsubscribeOrder = onSnapshot(doc(db, "orders", orderId), (snap) => {
    const order = snap.data();
    if (order) renderPaymentPanel(orderId, order);
  });
}

function activeStage(order) {
  if (order.depositStatus !== "paid") return "deposit";
  if (order.finalStatus === "not_due" || order.finalStatus === "paid") return null;
  return "final";
}

function renderPaymentPanel(orderId, order) {
  const panel = document.getElementById("azero-payment-panel");
  if (!panel) return;
  const stage = activeStage(order);

  if (!stage) {
    panel.innerHTML = order.finalStatus === "paid"
      ? statusBanner("green", "✓", "Fully paid — thank you! Your files are on the way.")
      : statusBanner("brand", "•", "Deposit received. Azero is working on your order — the final 50% will be requested once your preview is ready.");
    return;
  }

  const stageStatus = stage === "deposit" ? order.depositStatus : order.finalStatus;
  const amountUsd = stage === "deposit" ? order.depositAmountUsd : order.finalAmountUsd;
  const stageLabel = stage === "deposit" ? "50% deposit" : "remaining 50% balance";

  if (stageStatus === "awaiting_robux") {
    const tier = ROBLOX_PASSES[order.packageTier];
    panel.innerHTML = `
      <div class="bg-[#111] border border-brand/20 rounded-2xl p-6">
        <p class="text-white font-bold mb-1">Pay ${tier.robux.toLocaleString()} Robux (${stageLabel})</p>
        <p class="text-gray-500 text-xs mb-4">${tier.label}</p>
        <a href="https://www.roblox.com/game-pass/${tier.gamePassId}" target="_blank"
           class="block w-full bg-brand text-center py-4 rounded-xl text-white font-black text-xs uppercase tracking-widest hover:scale-[1.01] transition-all">
           Buy Game Pass on Roblox
        </a>
        <p class="text-gray-600 text-[10px] mt-3">Azero will confirm your payment here once received.</p>
      </div>`;
    return;
  }

  if (stageStatus === "awaiting_crypto") {
    const coin = CRYPTO_ADDRESSES[order.cryptoCoin];
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(coin.address)}`;
    panel.innerHTML = `
      <div class="bg-[#111] border border-brand/20 rounded-2xl p-6">
        <p class="text-white font-bold mb-1">Send ~$${amountUsd} in ${coin.label} (${stageLabel})</p>
        <p class="text-gray-500 text-xs mb-4">${coin.network || ""}</p>
        <div class="flex gap-5 items-center">
          <img src="${qrUrl}" class="rounded-lg border border-white/10" width="120" height="120">
          <div class="flex-1 min-w-0">
            <p class="text-gray-500 text-[10px] uppercase font-black tracking-widest mb-1">Address</p>
            <p class="text-white text-xs font-mono break-all">${coin.address}</p>
            <button id="azero-copy-addr" class="mt-3 text-brand text-[10px] font-black uppercase tracking-widest">Copy address</button>
          </div>
        </div>
        <p class="text-gray-600 text-[10px] mt-4">Azero will confirm your payment here once received.</p>
      </div>`;
    document.getElementById("azero-copy-addr").addEventListener("click", () => navigator.clipboard.writeText(coin.address));
    return;
  }

  // Chooser
  panel.innerHTML = `
    <div class="bg-[#111] border border-brand/20 rounded-2xl p-6">
      <p class="text-white font-bold mb-4">${stage === "deposit" ? "How would you like to pay your 50% deposit" : "How would you like to pay the remaining 50%"} ($${amountUsd})?</p>
      <div class="grid grid-cols-2 gap-3 mb-4">
        <button id="azero-pay-robux" class="py-4 rounded-xl border border-white/10 text-white font-black text-xs uppercase hover:border-brand">Robux</button>
        <button id="azero-pay-crypto" class="py-4 rounded-xl border border-white/10 text-white font-black text-xs uppercase hover:border-brand">Crypto</button>
      </div>
      <div id="azero-crypto-coins" class="hidden grid grid-cols-2 gap-2"></div>
    </div>`;

  const statusField = stage === "deposit" ? "depositStatus" : "finalStatus";

  document.getElementById("azero-pay-robux").addEventListener("click", async () => {
    await updateDoc(doc(db, "orders", orderId), { [statusField]: "awaiting_robux" });
  });

  document.getElementById("azero-pay-crypto").addEventListener("click", () => {
    const coinsEl = document.getElementById("azero-crypto-coins");
    coinsEl.classList.remove("hidden");
    coinsEl.innerHTML = Object.entries(CRYPTO_ADDRESSES).map(([key, c]) =>
      `<button data-coin="${key}" class="azero-coin-btn py-3 rounded-xl border border-white/10 text-white text-xs font-bold hover:border-brand">${c.label}</button>`
    ).join("");
    coinsEl.querySelectorAll(".azero-coin-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await updateDoc(doc(db, "orders", orderId), { [statusField]: "awaiting_crypto", cryptoCoin: btn.dataset.coin });
      });
    });
  });
}

function statusBanner(color, icon, text) {
  const colorClasses = color === "green" ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-brand/10 border-brand/30 text-brand";
  return `<div class="${colorClasses} border rounded-2xl p-5 flex items-center gap-3">
    <span class="font-black text-xl">${icon}</span><span class="font-bold text-sm">${text}</span>
  </div>`;
}

/** Used by myorders.html to list a client's own orders. */
async function listMyOrders() {
  const user = window.azeroAuth ? window.azeroAuth.getCurrentUser() : null;
  if (!user) return [];
  const q = query(collection(db, "orders"), where("uid", "==", user.uid), orderBy("createdAt", "desc"));
  return new Promise((resolve) => {
    onSnapshot(q,
      (snap) => resolve(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.error("listMyOrders query failed:", err);
        // Firestore throws this specific error when a query needs a composite
        // index it doesn't have yet — the real error in your browser console
        // (F12) includes a direct link to auto-create it in Firebase Console.
        if (err.code === "failed-precondition") {
          console.error("This query needs a Firestore index — check the link in this error message, open it, click 'Create Index', then wait ~1 minute and reload.");
        }
        resolve([]);
      },
      { onlyOnce: true }
    );
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.innerText = str;
  return div.innerHTML;
}

window.azeroOrderChat = { createOrderAndOpenChat, openChatUI, listMyOrders };

/* ============================================================
   FIRESTORE RULES — Firebase Console > Firestore Database > Rules
   ============================================================
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /orders/{orderId} {
         allow create: if request.auth != null;
         allow read, update: if request.auth != null;
         match /messages/{messageId} {
           allow read, create: if request.auth != null;
         }
       }
     }
   }
*/
