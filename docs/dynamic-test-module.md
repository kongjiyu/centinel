# Centinel Dynamic Test Module

## Overview

The Dynamic Test module is an AI-powered end-to-end testing system that autonomously interacts with web applications through a real browser. It uses vision AI models to understand screenshots, make decisions, and execute actions to achieve specified testing goals.

## What It Does

### Core Capabilities

- **Autonomous Browser Control**: Opens a Chromium browser and navigates to target web applications
- **Vision-Based Understanding**: Takes screenshots at each step and uses AI to understand the current page state
- **Intelligent Action Planning**: Based on the goal and current state, the AI decides what action to take next
- **Step-by-Step Execution**: Performs actions like clicking, typing, scrolling, and navigating
- **Goal Achievement Detection**: Recognizes when the test goal is achieved or when it's impossible to continue
- **Comprehensive Evidence Collection**: Captures screenshots, AI responses, action traces, and debug logs

### Test Types

| Type | Description | Use Case |
|------|-------------|----------|
| **User Journey** | Tests a complete user workflow end-to-end | Login flows, checkout processes, form submissions |
| **Smoke Test** | Quick validation of critical functionality | Basic page loads, key element visibility |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Tauri Desktop App                       │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │   React UI       │◄──►│   Sidecar Server (Node.js)     │ │
│  │                  │    │                                 │ │
│  │  - Session Mgmt  │    │  - Dynamic Runner               │ │
│  │  - Evidence View │    │  - Vision AI Integration        │ │
│  │  - Report Export │    │  - Playwright Browser Control   │ │
│  └─────────────────┘    └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────┐
│                     External Services                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  MiMo AI     │  │  Gemini AI   │  │  Target Web App  │  │
│  │  (Vision)    │  │  (Vision)    │  │  (Browser)       │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## How It Works

### Step-by-Step Process

1. **Session Initialization**
   - User creates a new Dynamic Test session
   - Specifies target URL, goal, mission type, and max steps
   - System launches a Chromium browser

2. **Screenshot Capture**
   - Takes a screenshot of the current page state
   - Saves to `<workspace>/sessions/<sessionId>/screenshots/`

3. **Context Extraction**
   - Extracts visible text, interactive elements, and page metadata
   - Includes accessibility information (aria-labels, roles, placeholders)

4. **AI Vision Analysis**
   - Sends screenshot + context + goal to the vision AI model
   - AI returns a structured JSON action

5. **Action Execution**
   - Executes the AI-suggested action (click, type, scroll, etc.)
   - Retries on failure (up to 2 attempts)

6. **Loop**
   - Repeats steps 2-5 until:
     - Goal is achieved (`finish_success`)
     - Goal is impossible (`finish_failure`)
     - Max steps reached
     - Timeout (5 minutes)
     - User cancels

7. **Evidence Collection**
   - Generates action trace, summary report
   - Stores all evidence for later review

## Supported Actions

| Action | Description | Example |
|--------|-------------|---------|
| `click` | Click on an element | Click a button |
| `type` | Type text into an input field | Enter username/password |
| `press_key` | Press a keyboard key | Press Enter to submit |
| `scroll` | Scroll the page | Scroll down to see more content |
| `wait` | Wait for a specified time | Wait for page to load |
| `navigate` | Navigate to a URL | Go to a different page |
| `assert_visible` | Check if text is visible | Verify error message appears |
| `finish_success` | Mark test as passed | Goal achieved |
| `finish_failure` | Mark test as failed | Goal impossible |

## AI Provider Configuration

### Supported Providers

| Provider | API Format | Default Model | Auth Header |
|----------|------------|---------------|-------------|
| MiMo | OpenAI-compatible | mimo-v2.5 | `api-key` |
| MiMo | Anthropic-compatible | mimo-v2.5 | `api-key` |
| MiMo Pro | OpenAI-compatible | mimo-v2.5-pro | `api-key` |
| MiMo Pro | Anthropic-compatible | mimo-v2.5-pro | `api-key` |
| Google Gemini | Google Native | gemini-2.5-flash | Query param |

### Configuration

Navigate to **Settings** → **Multimodal Vision** to configure:

1. Select a provider preset (e.g., "MiMo (OpenAI-compatible)")
2. Enter your API key
3. Base URL and Model are auto-filled based on preset
4. Click "Save" and "Test" to verify

## Usage Guide

### Creating a Dynamic Test

1. **Open your project** in the Centinel app

2. **Click "New Dynamic Test"**

3. **Configure the test:**
   - **Target URL**: The web application URL to test (e.g., `http://localhost:37702`)
   - **Goal**: Describe what you want to achieve (e.g., "Enter invalid credentials and verify error message appears")
   - **Mission Type**: Choose "User Journey" for complete flows or "Smoke Test" for quick checks
   - **Max Steps**: Maximum number of actions (1-25, default 15)

4. **Click "Submit"** to start the test

### Monitoring Progress

During the test, you can observe:

- **Screenshots**: Real-time page captures as the test progresses
- **Action Trace**: List of all actions taken with results
- **AI Responses**: What the vision model decided at each step
- **Console Logs**: Browser console output
- **Debug Log**: Detailed execution information

### Reviewing Results

After the test completes:

- **Status**: Shows if the test passed, failed, or was blocked
- **Summary**: AI-generated explanation of what happened
- **Screenshots**: Click any screenshot to enlarge and inspect
- **Action Trace**: Detailed step-by-step execution log
- **Export Summary**: Generate a Markdown report

### Exporting Reports

Click "Export Summary" to:

1. View a rendered Markdown report in the app
2. See the report file location
3. Copy the file path for sharing

Reports are saved to `<workspace>/reports/` and include:
- Test configuration
- Results and status
- Action trace table
- Screenshot list
- AI communication summary
- References to all evidence files

## Evidence Structure

```
<workspace>/sessions/<sessionId>/
├── screenshots/
│   ├── step-000.png          # Screenshot at each step
│   ├── step-001.png
│   ├── ...
│   └── final.png             # Final page state
├── ai/
│   ├── step-000-request.json # AI request with prompt + context
│   ├── step-000-response.json# AI response with action
│   ├── ...
├── logs/
│   ├── session-debug.json    # Complete debug log with timestamps
│   ├── action-trace.json     # Structured action execution log
│   └── console.json          # Browser console output
└── summary.md                # Human-readable test summary
```

## Debugging

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Vision AI provider not configured" | No vision API key set | Configure vision provider in Settings |
| "Model returned empty response" | AI exhausted tokens on thinking | Already fixed with `thinking: { type: 'disabled' }` |
| "Model returned invalid response" | AI returned unparseable JSON | System retries and attempts JSON repair |
| "Action failed after 2 attempts" | Element not found or not interactable | Check if the page structure matches expectations |
| "Session timed out" | Test took longer than 5 minutes | Increase max steps or simplify the goal |
| Screenshots not loading | File path issues | Fixed with sidecar evidence-file endpoint |

### Debug Log Analysis

The `session-debug.json` file contains structured events:

```json
[
  {
    "timestamp": "2026-06-19T12:00:00.000Z",
    "level": "info",
    "phase": "ai_request",
    "step": 0,
    "message": "Calling vision model"
  },
  {
    "timestamp": "2026-06-19T12:00:02.500Z",
    "level": "info",
    "phase": "action_execute",
    "step": 0,
    "message": "Executing type"
  }
]
```

Phases: `session_start`, `navigation`, `screenshot`, `context_extract`, `ai_request`, `ai_response`, `json_parse`, `action_execute`, `retry`, `session_end`

### Failure Categories

| Category | Description |
|----------|-------------|
| `missing_vision_provider` | No vision AI configured |
| `vision_api_error` | API call failed (HTTP error, network issue) |
| `invalid_ai_response` | AI returned unparseable response |
| `action_execution_failed` | Playwright action failed |
| `navigation_blocked` | Tried to navigate outside target origin |
| `timeout` | Session exceeded 5-minute limit |
| `max_steps_reached` | Ran out of allowed steps |
| `cancelled` | User cancelled the session |

## Retry Policy

The system automatically retries failed operations:

| Operation | Max Attempts | Backoff |
|-----------|--------------|---------|
| Vision API call | 3 | 1.5s × attempt |
| JSON repair | 1 | Immediate |
| Action execution | 2 | 0.5s |

## Security Considerations

- **Same-Origin Guard**: Navigation is restricted to the target URL's origin
- **Evidence Validation**: File serving only allows registered evidence files
- **No Destructive Actions**: The AI is instructed to avoid delete, payment, or file upload actions
- **API Key Storage**: Keys are stored locally in SQLite, never transmitted except to configured providers

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/projects/:id/dynamic-sessions` | Create new session |
| GET | `/projects/:id/dynamic-sessions` | List sessions |
| GET | `/projects/:id/dynamic-sessions/:sid` | Get session details |
| GET | `/projects/:id/dynamic-sessions/:sid/evidence` | List evidence |
| POST | `/projects/:id/dynamic-sessions/:sid/cancel` | Cancel session |
| POST | `/projects/:id/dynamic-sessions/:sid/report` | Export report |
| GET | `/evidence-file?path=<path>` | Serve evidence image |

## Example Test Goals

### Login Validation
```
Goal: Enter invalid credentials (wrong password), submit the login form, 
      and verify an error message appears
Target: http://localhost:37702
Type: User Journey
Max Steps: 10
```

### Form Submission
```
Goal: Fill out the contact form with valid data and submit it, 
      then verify the success message appears
Target: https://example.com/contact
Type: User Journey
Max Steps: 15
```

### Navigation Check
```
Goal: Click through the main navigation menu items and verify 
      each page loads correctly
Target: https://example.com
Type: Smoke Test
Max Steps: 20
```

### Shopping Cart
```
Goal: Add a product to the cart, go to checkout, 
      and verify the cart contents are correct
Target: https://example.com/shop
Type: User Journey
Max Steps: 15
```

## Best Practices

1. **Write Clear Goals**: Be specific about what you want to achieve
2. **Start Simple**: Test basic flows before complex scenarios
3. **Use Appropriate Max Steps**: Don't set too high; 10-15 is usually enough
4. **Review Evidence**: Check screenshots and action traces to understand failures
5. **Export Reports**: Generate reports for documentation and submission
6. **Configure Retry**: The system handles retries automatically, but you can adjust timeouts if needed

## Limitations

- **Desktop Apps**: Only supports web applications (not native desktop apps)
- **Authentication**: Cannot handle complex auth flows (OAuth, 2FA) automatically
- **File Uploads**: Explicitly avoided for safety
- **Payments**: Explicitly avoided for safety
- **Real-Time Data**: May not handle rapidly changing content well
- **Canvas/WebGL**: Vision AI may struggle with canvas-based UIs

## Future Enhancements

- [ ] Custom action scripts
- [ ] Multi-tab support
- [ ] Mobile viewport testing
- [ ] Performance metrics collection
- [ ] CI/CD integration
- [ ] Parallel test execution
- [ ] Custom AI prompts
- [ ] Test data fixtures
