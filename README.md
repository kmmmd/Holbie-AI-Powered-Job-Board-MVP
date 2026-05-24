# 📋 Holbie — AI-Powered Job Board & Live Support Chat MVP

Holbie is a fully functional Minimum Viable Product (MVP) featuring an assistance request system and a real-time live support chat. This entire application was co-created and developed through an **AI-assisted workflow using Townie AI (Val Town)**.

## 🚀 Live Demo
Experience the live application here:
🔗 https://kubrammmdova1--d16935aa56c311f18b5dee650bb23af1.web.val.run/

---

## 🛠️ Tech Stack & Architecture
This project is contained within a single monolithic file architecture leveraging modern cloud-native web tools:
- **Environment & Backend:** Deno / TypeScript (via Val Town)
- **Database (Persistence):** SQLite (via `std/sqlite` for persistent requests and chat logs)
- **Real-Time Layer:** Server-Sent Events (SSE) protocol for instant browser synchronization
- **Frontend & UI:** HTML5, Modern JavaScript, and styled responsively using Tailwind CSS Flexbox configurations

---

## 🤖 AI Development Workflow & Prompts
This project was developed strictly adhering to iterative AI programming methodologies. Below are the sequential prompts utilized to instruct Townie AI during the building phase:

### 🔹 Prompt 1: Core Layout Establishment (Task 1)
> "Build a simple HTML interface inside this HTTP val. It should have an input field for assistance requests, a submit button, and a display area where submitted requests appear."

### 🔹 Prompt 2: Data Architecture & Optimization (Task 2 & 3 Short-burst)
> "Add Task 3 (Real-Time Chat) to this val. Create a tab system: "Requests" and "Live Chat". In Chat, require a username to join. Use BroadcastChannel for instant, real-time messaging without page refresh. Save chat messages to SQLite for persistence. Keep UI minimal."

### 🔹 Prompt 3: Polishing, Responsiveness & Final Integration (Task 4 & 5)
> "Please build the complete Holbie application incorporating all specifications from Task 1, 2, 3, 4, and 5 into a single main.ts file. Ensure the following features are fully functional and polished:
> 1. Tab Navigation & Responsive UI: Create a clean, modern tab system to switch between 'Requests' and 'Live Chat'. Use Tailwind CSS to make the entire UI beautiful and responsive.
> 2. Requests Section: Include a styled input textarea, a submit button, and a modern list area below showing submitted requests with timestamps from SQLite. Add successful alert notifications upon submission.
> 3. Live Chat Section: Implement a strict username login screen before entering the chat with beautiful responsive chat bubbles.
> 4. Real-Time & Persistence: Use BroadcastChannel or Server-Sent Events (SSE) for instant message syncing. Ensure everything persists safely in SQLite across sessions."

---

## 🌟 Key Features Implemented
- **Username Gate:** Secure barrier requiring user identification prior to real-time chat insertion.
- **Bi-Directional Persistence:** Both customer job requests and chat transcripts survive application recycles using server-side SQLite engines.
- **Validation Shield:** Rigorous client and server-side request sanitization preventing duplicate entries or malicious empty string payloads.
- **Mobile-First UX:** Fully adaptive UI scaling seamlessly between multi-monitor desktop environments and handheld screens.
