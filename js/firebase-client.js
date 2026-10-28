import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getDatabase, ref, set, onValue, push, child, update, remove, onDisconnect, get
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { FIREBASE_CONFIG } from "./firebase-config.js";

const firebaseApp = initializeApp(FIREBASE_CONFIG);
const database = getDatabase(firebaseApp);

// Public adapter consumed by the application and multiplayer layer.
window.firebaseDB = {
  db: database,
  ref,
  set,
  onValue,
  push,
  child,
  update,
  remove,
  onDisconnect,
  get
};
