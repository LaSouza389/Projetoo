
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyARTd36T0azSA1ANAq0CgdhsA0GlyNiFZk",
  authDomain: "projeto-grau.firebaseapp.com",
  projectId: "projeto-grau",
  storageBucket: "projeto-grau.firebasestorage.app",
  messagingSenderId: "914357987738",
  appId: "1:914357987738:web:3ef10962c7f552a1a9b223",
  measurementId: "G-FT312KDMLD"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
