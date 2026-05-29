# PRD: Centinel — AI-Based Software Quality Assurance Platform

## 1. Product Overview
Centinel is an AI-based software quality assurance platform designed to improve software quality through two complementary modules:

- **Module 1: Centinel Static** — supports static testing by reviewing software artifacts without executing the application.
- **Module 2: Centinel Dynamic** — supports dynamic testing by autonomously interacting with the application to validate runtime behavior.

The platform is intended for **SMEs, resource-constrained software teams, developers, QA engineers, and testers** who need to reduce manual quality assurance effort while improving review quality, testing efficiency, and traceability.

---

## 2. Product Vision
To provide a practical AI-assisted QA platform that helps software teams perform both **static** and **dynamic** testing more efficiently, with less manual effort and more structured outputs.

Centinel aims to:
- reduce repetitive quality assurance work,
- improve early defect detection,
- improve runtime defect detection during user-flow execution,
- support decision-making with structured review and testing outputs,
- increase consistency and traceability in software quality activities.

---

## 3. Background and Rationale
Software testing and quality engineering remain highly manual and time-consuming in many organizations. Industry findings continue to show that testing is a bottleneck to delivery and that AI adoption in quality engineering is still immature, with many teams remaining in experimentation rather than scaled use. Official testing guidance also distinguishes between **static testing**, which evaluates work products without executing software, and **dynamic testing**, which validates behavior during execution. These two activities solve different problems and are therefore separated into two modules in Centinel. [^1][^2]

For resource-constrained teams, these challenges are amplified:
- **Static testing** activities such as walkthroughs, document review, and code inspection consume valuable senior developer time.
- **Dynamic testing** activities such as smoke testing, regression testing, exploratory testing, and end-to-end workflow validation are often brittle, maintenance-heavy, and difficult to scale.

Centinel is scoped as one integrated platform so both modules can share reporting concepts, evidence handling, and AI-assisted decision support while still addressing distinct testing needs.

---

## 4. Problem Statement
### 4.1 Overall Problem
Software teams, especially SMEs and resource-constrained teams, face high manual effort in both **static** and **dynamic** quality assurance activities. This reduces productivity, delays delivery, and increases the chance that defects remain undetected until later stages.

### 4.2 Static Testing Problem
Manual walkthroughs, reviews, and inspections require significant developer time and produce inconsistent outcomes when reviewers are overloaded. Teams also spend additional time maintaining review records, defect summaries, and traceability artifacts.

### 4.3 Dynamic Testing Problem
QA teams face major difficulties in end-to-end functional testing because tests are often brittle, expensive to maintain, and unreliable when interfaces change. Script-based automation can break when elements cannot be located, while flaky UI tests reduce confidence in automated results. Existing automation also still requires significant manual setup and maintenance. [^3][^4][^5][^6]

---

## 5. Proposed Solution
Centinel addresses the above problems through two coordinated modules.

### 5.1 Centinel Static
Centinel Static functions as a **static testing decision-support framework**. It analyzes software artifacts such as:
- requirement specifications,
- design documents,
- coding standards,
- source code,
- traceability relationships.

It is intended to:
- detect inconsistencies,
- identify missing requirement coverage,
- detect logic mismatches,
- detect structural defects,
- generate static review outputs automatically.

This reduces repetitive review effort and documentation overhead while allowing developers to focus on evaluating findings and approving actions.

### 5.2 Centinel Dynamic
Centinel Dynamic functions as an **autonomous AI QA agent** for runtime validation. Instead of depending entirely on manually scripted selectors and fixed automation rules, the system uses:
- **vision-based interface understanding**,
- **high-level testing goals in natural language**,
- **adaptive action planning**,
- **autonomous UI interaction**.

It is intended to:
- execute smoke testing,
- execute regression testing,
- execute exploratory testing,
- validate end-to-end user journeys,
- generate structured evidence such as logs, session outputs, and reproducible bug reports.

---

## 6. Product Goals
### 6.1 Overall Goals
- Reduce manual effort in software quality assurance.
- Improve consistency and traceability of review and testing outcomes.
- Provide practical AI support for both non-execution and execution-based testing.
- Support resource-constrained teams with a more sustainable QA workflow.

### 6.2 Static Module Goals
- Reduce manual review and inspection effort.
- Improve completeness of static review outputs.
- Improve requirement-to-implementation validation.
- Reduce time spent producing review documentation.

### 6.3 Dynamic Module Goals
- Reduce manual test case and test script creation.
- Reduce dependence on brittle scripted automation.
- Improve validation of real user workflows.
- Improve evidence generation for bug reporting and debugging.

---

## 7. Target Users
### Primary Users
- **QA engineers**
- **software testers**
- **developers performing review activities**

### Secondary Users
- **SMEs and resource-constrained software teams**
- **team leads or project stakeholders who need review and test evidence**

---

## 8. Scope of the Project
## 8.1 In Scope (Overall)
- AI-assisted software quality assurance platform
- Static testing support
- Dynamic testing support
- Structured report and evidence generation
- Shared QA platform concept across both modules

### 8.2 Module 1 Scope: Centinel Static
**Handled by:** Static Testing owner / teammate

#### In scope
- Requirement specification review
- Design document review
- Coding standard review
- Source code inspection support
- Detection of inconsistencies across artifacts
- Detection of missing requirement coverage
- Detection of logic mismatches
- Detection of structural defects
- Review summary generation
- Defect report generation
- Traceability record generation
- Inspection finding generation
- Recommendation report generation

#### Main users
- Developers
- Technical reviewers
- SMEs with limited senior reviewer resources

### 8.3 Module 2 Scope: Centinel Dynamic
**Handled by:** Dynamic Testing owner / you

#### In scope
- Autonomous navigation of application interfaces
- End-to-end functional testing
- Smoke testing
- Regression testing
- Exploratory testing
- Validation of user journeys such as login, form submission, checkout, and multi-step workflows
- Vision-based screen understanding
- Natural-language-driven testing goals
- Adaptive UI interaction through clicking, typing, and navigation
- Session evidence generation
- Logs and reproducible bug reports
- Session bundles and frustration heatmaps

#### Main users
- QA engineers
- Testers
- Teams needing execution-based validation support

### 8.4 Shared Platform Scope
The following are shared concepts across both modules:
- Common **Centinel** platform identity
- Shared project/session context
- Shared reporting and artifact concepts
- Structured evidence handling
- AI-assisted decision support

---

## 9. Out of Scope
The following are outside the scope of this FYP implementation:
- Full enterprise CI/CD integration
- Performance testing and load testing
- Penetration testing or advanced security testing
- Full production deployment across all environments
- Support for all possible programming languages and frameworks
- Full replacement of commercial testing suites
- Complete autonomous decision-making without human review
- Advanced team collaboration, synchronization, or cloud workflow management

---

## 10. Key Features
### 10.1 Centinel Static
- Artifact review assistant
- Cross-artifact consistency checking
- Requirement-to-code validation support
- Review summary generation
- Defect and traceability documentation support

### 10.2 Centinel Dynamic
- Autonomous UI exploration
- Mission-based execution (smoke, regression, exploratory)
- Runtime workflow validation
- Visual interaction with the interface
- Structured evidence and bug reporting
- Frustration heatmap and execution trace generation

---

## 11. Functional Requirements
### 11.1 Static Module Functional Requirements
- The system shall accept software artifacts for review.
- The system shall compare related artifacts to identify inconsistencies.
- The system shall identify missing or weak requirement coverage.
- The system shall generate structured static review findings.
- The system shall generate review-related documents automatically.

### 11.2 Dynamic Module Functional Requirements
- The system shall accept high-level testing goals in natural language.
- The system shall capture the application interface and interpret UI elements.
- The system shall perform actions such as clicking, typing, and navigating.
- The system shall execute dynamic test missions.
- The system shall generate logs, session evidence, and bug reports.

### 11.3 Shared Functional Requirements
- The system shall store structured outputs from both modules.
- The system shall support human review of AI-generated findings.
- The system shall maintain traceability of generated QA artifacts.

---

## 12. Non-Functional Requirements
- **Usability:** The system should be understandable to non-expert technical users.
- **Maintainability:** The system should be modular so static and dynamic modules can evolve independently.
- **Traceability:** Outputs should be structured and reviewable.
- **Reliability:** Findings and execution evidence should be reproducible where possible.
- **Security/Privacy:** Sensitive project information and test artifacts should be handled carefully, especially for local project usage.

---

## 13. User Stories
### Static Module
- As a **developer**, I want the system to review source code and related artifacts so that I can identify inconsistencies before runtime testing.
- As a **reviewer**, I want automatic review summaries and traceability records so that I spend less time on manual documentation.

### Dynamic Module
- As a **QA engineer**, I want to provide a high-level testing goal in natural language so that the system can execute the relevant workflow automatically.
- As a **tester**, I want the system to generate session evidence and bug reports so that I can communicate findings clearly.

### Shared Platform
- As a **team member**, I want outputs from both static and dynamic testing to follow a consistent structure so that project quality evidence is easier to manage.

---

## 14. Expected Outcomes
By the end of the project, Centinel is expected to provide:
- a working concept of an AI-based QA platform,
- a static testing module that reduces manual review overhead,
- a dynamic testing module that reduces manual scripting and execution effort,
- structured QA outputs for both review and runtime testing,
- clearer division of QA support across artifact-level and execution-level validation.

---

## 15. Proposed Team Ownership
### Static Testing Owner
Responsible for:
- artifact review logic,
- review workflow design,
- review output generation,
- traceability and static defect reporting.

### Dynamic Testing Owner
Responsible for:
- autonomous UI interaction,
- dynamic test mission design,
- end-to-end functional validation,
- runtime evidence and bug reporting.

---

## 16. Success Criteria
The project will be considered successful if:
- the static module can analyze selected artifacts and generate structured review outputs,
- the dynamic module can execute selected user workflows and produce testing evidence,
- both modules demonstrate reduced manual effort compared to purely manual approaches,
- both modules produce outputs that are understandable and reviewable by the intended users.

---

## 17. References
[^1]: ISTQB. *Certified Tester Foundation Level Syllabus v4.0.1*. Static testing evaluates work products without executing the software, while dynamic testing involves execution. https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf
[^2]: Capgemini, Sogeti, & OpenText. *World Quality Report 2025–26*. Testing remains manual and time-consuming, and AI adoption in quality engineering is still limited. https://www.capgemini.com/insights/research-library/world-quality-report-2025-26/
[^3]: Selenium. *The Selenium Browser Automation Project*. Selenium supports automation of web browsers. https://www.selenium.dev/documentation/
[^4]: Playwright. *Best Practices* and *Auto-waiting*. Playwright emphasizes resilient locators, auto-waiting, and retryable assertions. https://playwright.dev/docs/best-practices and https://playwright.dev/docs/actionability
[^5]: mabl. *Unified Test Automation Platform for Web, Mobile, and APIs*. https://www.mabl.com/platform
[^6]: Chevrot, A., Vernotte, A., Falleri, J.-R., Blanc, X., & Legeard, B. (2025). *Are autonomous web agents good testers?* https://arxiv.org/abs/2504.01495
