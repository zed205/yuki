# Migration Task List

## Legend
- [x] Completed
- [ ] Pending
- [!] Blocked
- [~] Optional / nice-to-have

---

## Phase 0: Preparation

- [x] 0.1 Create UIMigration directory structure
- [x] 0.2 Write detailed plan.md
- [x] 0.3 Audit current YUi components (documented in component-mapping.md)
- [x] 0.4 Install @opencode/ui package
- [x] 0.5 Install SolidJS dependencies
- [x] 0.6 Set up Vite + TypeScript for client
- [x] 0.7 Create vite.config.ts
- [x] 0.8 Create tsconfig.client.json
- [x] 0.9 Create Vite entry index.html
- [x] 0.10 Create src/main.tsx (entry point)

---

## Phase 1: Foundation

- [x] 1.1 Create src/App.tsx with providers (ThemeProvider, QueryClientProvider, Router)
- [x] 1.2 Create src/index.css (Tailwind + shadcn/ui styles)
- [x] 1.3 Verify Vite build succeeds
- [x] 1.4 Verify theme loading works (Yuki GitHub Dark as default)
- [x] 1.5 Verify router renders basic route
- [x] 1.6 Verify WebSocket context can connect to existing server

---

## Phase 2: Component Migration

### 2.1 Core Layout
- [x] 2.1.1 Create src/components/Layout/MainLayout.tsx
- [x] 2.1.2 Create src/components/Sidebar/Sidebar.tsx
- [x] 2.1.3 Create src/components/Sidebar/SessionTree.tsx
- [x] 2.1.4 Create src/components/Sidebar/ProjectList.tsx
- [x] 2.1.5 Create src/components/Layout/MainLayout.tsx (done in 2.1.1)
- [x] 2.1.6 Implement mobile responsive sidebar (drawer pattern)
- [x] 2.1.7 Implement sidebar collapse/expand toggle

### 2.2 Chat / Messages
- [x] 2.2.1 Create src/components/Chat/ChatPanel.tsx
- [x] 2.2.2 Create src/components/Chat/MessageBubble.tsx
  - [x] User message styling
  - [x] Assistant message styling
  - [x] System/summary message styling
  - [x] Sub-agent message styling
  - [x] Markdown rendering
  - [x] Code block rendering
  - [x] Streaming indicator
- [x] 2.2.3 Create src/components/Chat/ScrollManager.tsx

### 2.3 Composer / Input
- [x] 2.3.1 Create src/components/Chat/Composer.tsx
  - [x] Textarea with Enter/Shift+Enter handling
  - [x] Send button
  - [x] Stop button (streaming state)
  - [x] Image attachment preview
  - [x] File attachment handler
- [~] 2.3.2 SlashCommand typeahead (placeholder in Composer)
- [~] 2.3.3 FilePicker typeahead (placeholder in Composer)

### 2.4 Browser View
- [x] 2.4.1 Create src/components/Browser/BrowserView.tsx
- [x] 2.4.2 Create src/components/Browser/BrowserToolbar.tsx
  - [x] URL input
  - [x] Go button
  - [x] Screenshot button
  - [x] Close button
- [~] 2.4.3 Implement iframe sandboxing
- [~] 2.4.4 Implement screenshot display

### 2.5 Voice Panel
- [x] 2.5.1 Create src/components/Voice/VoicePanel.tsx
- [x] 2.5.2 Create src/components/Voice/VoiceControls.tsx
- [x] 2.5.3 Create src/hooks/useVoiceStatus.ts
- [x] 2.5.4 Integrate with audio context
  - [x] Web Speech API (STT)
  - [x] Web Audio API (TTS)
  - [x] Voice mode indicator
  - [x] Mic toggle
  - [x] TTS toggle

### 2.6 Settings / Modals
- [x] 2.6.1 Create src/components/Settings/SettingsModal.tsx
- [x] 2.6.2 Create src/components/Settings/VoiceSettings.tsx
- [x] 2.6.3 Create src/components/Settings/AgentSettings.tsx
- [x] 2.6.4 Create src/components/Settings/ModelSettings.tsx
- [x] 2.6.5 Create src/components/Settings/ThemeSettings.tsx
  - [x] Theme picker (40+ themes)
  - [x] Light/Dark toggle
  - [x] Color scheme selector
- [x] 2.6.6 Create src/components/Modals/RenameModal.tsx
- [x] 2.6.7 Create src/components/Modals/ConfirmModal.tsx
- [x] 2.6.8 Create src/components/Modals/ToolModal.tsx

### 2.7 Tool / Thinking View
- [x] 2.7.1 Create src/components/Tools/ToolLog.tsx
- [x] 2.7.2 Create src/components/Tools/ThinkingIndicator.tsx
- [x] 2.7.3 Create src/components/Tools/ToolStatusBadge.tsx

---

## Phase 3: State Management

- [x] 3.1 Create src/context/SessionContext.tsx
  - [x] Session tree state
  - [x] Current session selection
  - [x] Session CRUD operations
- [x] 3.2 Create src/context/AudioContext.tsx
  - [x] Voice mode state
  - [x] Mic state
  - [x] TTS state
- [x] 3.3 Create src/context/BrowserContext.tsx
  - [x] Browser connection state
  - [x] Current URL
  - [x] Screenshot state
- [x] 3.4 Create src/context/WebSocketContext.tsx
  - [x] WebSocket connection management
  - [x] Reconnection logic with exponential backoff
  - [x] Message sending/receiving
- [x] 3.5 Create src/context/ProjectContext.tsx
  - [x] Project list
  - [x] Active project
  - [x] Project settings
- [x] 3.6 Migrate all global variables from app.js to contexts
  - [x] messages array
  - [x] isStreaming flag
  - [x] voiceMode, mic, tts flags
  - [x] notification preferences
  - [x] compact mode flag

---

## Phase 4: Theming

- [x] 4.1 Create src/theme/yuki-brand.css
- [x] 4.2 Test all @opencode/ui themes with Yuki brand overrides
- [x] 4.3 Create src/theme/custom-themes/yuki-dark.json
- [x] 4.4 Create src/theme/custom-themes/yuki-light.json
- [x] 4.5 Test theme switching at runtime
- [x] 4.6 Persist theme preference to localStorage

---

## Phase 5: Server Integration

- [x] 5.1 Update src/server/index.ts to serve client-v2
- [x] 5.2 Update scripts/copy-client.js for Vite output
- [x] 5.3 Verify Express serves SolidJS SPA correctly
- [x] 5.4 Verify SPA fallback routing (all routes → index.html)
- [x] 5.5 Verify WebSocket endpoint still works
- [~] 5.6 Test hot module replacement in dev mode

---

## Phase 6: Assets & Icons

- [x] 6.1 Copy Yuki SVG logo to public directory
- [x] 6.2 Configure @opencode/ui file type icons
- [x] 6.3 Configure @opencode/ui app icons
- [x] 6.4 Add custom Yuki app icon
- [x] 6.5 Configure fonts

---

## Phase 7: Big Bang Migration (Feature Branch)

- [x] 7.1 Create branch `feat/ui-migration`
- [x] 7.2 Build all SolidJS components on branch
- [x] 7.3 Feature parity check on branch
- [x] 7.4 Final integration testing (build succeeds)
- [x] 7.5 Merge PR to main — single commit, single deployment

---

## Phase 8: Testing

- [~] 8.1 Set up vitest + @solidjs/testing-library
- [~] 8.2 Write component tests
- [~] 8.3 Write Playwright E2E tests
- [~] 8.4 Accessibility audit

---

## Phase 9: Performance

- [~] 9.1 Implement code splitting (lazy loading for routes)
- [~] 9.2 Implement virtual scrolling for long message lists
- [~] 9.3 Lazy-load browser screenshots
- [~] 9.4 Implement WebSocket reconnection with backoff (done in context)
- [~] 9.5 Lighthouse audit

---

## Phase 10: Deployment

- [x] 10.1 Final production build on branch
- [x] 10.2 Branch testing
  - [x] Vite build succeeds
  - [x] All components render
  - [x] WebSocket connects
  - [x] Theme switching works
  - [x] Mobile responsive
- [x] 10.3 Merge PR to main — single commit, single deployment
- [x] 10.4 Old `src/client/` kept for reference
- [x] 10.5 Rollback: `git revert` the merge commit if needed

---

## Summary

- **Total tasks:** ~95
- **Completed:** ~80 (foundation + all core components + contexts + theming + server integration)
- **Optional/Nice-to-have:** ~15 (testing, virtual scrolling, HMR testing)
- **Build:** ✅ Vite build succeeds (149 modules, ~105kb JS + 44kb CSS)
- **Branch:** `feat/ui-migration` committed
