# Overview

The SAT Learning Copilot (Lyceon) is an AI-powered full-stack web application designed to help students prepare for the SAT. It extracts questions and answers from SAT practice PDFs and provides an interactive, AI-driven tutoring experience. The system leverages document processing, vector-based similarity search, and AI-generated responses to deliver personalized, contextual learning, aiming to make SAT preparation effective and accessible through advanced AI.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend
The frontend uses React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Wouter for routing, TanStack React Query for server state, and Radix UI with Framer Motion for accessible UI components and animations. The design adheres to a two-color palette (Cream and Navy) and incorporates server-rendered public pages for SEO with standard React SPA for private routes.

## Backend
The backend is built with Node.js, Express.js, and TypeScript, offering a RESTful API for practice management and progress tracking. It includes bearer token authentication, CSRF protection, Helmet, rate limiting, and configurable CORS.

## Database & Storage
PostgreSQL, managed via Supabase, serves as the primary database. It utilizes Row-Level Security (RLS) and pgvector for semantic search, with all database operations handled by `supabaseServer`.

## AI Integration
Google Gemini AI provides all AI functionalities. The `text-embedding-004` model is used for RAG and semantic search, while `gemini-2.0-flash` powers conversational AI tutoring. A RAG architecture, guided by a production-safe tutor prompt, ensures contextual learning, anti-hallucination, transparency, and citation.

## Data Processing Pipelines
**Ingestion v3 (PDF Processing):** This pipeline uses an LLM-Schema Architecture with DocAI-primary extraction and Gemini Vision fallback to process SAT practice PDFs, including OCR, question parsing, and upserting to Supabase and the vector store.
**Ingestion v4 (AI-powered Question Generation):** This pipeline uses Gemini for generating original SAT-style questions, employing a "Teacher Agent" for generation and a "TA Agent" for QA validation, supporting batch runs, style bank integration, and tiered metadata. Questions are identified using Canonical Question IDs (CQID).
**Dynamic Clustering System:** An LLM-based clustering system groups style pages for coherent pack selection, using Gemini to analyze PNGs and extract structural signatures, supporting cluster-first sampling for question generation and providing provenance tracking.

## Student Weakness Tracking & Adaptive Learning
The platform tracks student attempts and computes mastery rollups by skill and question cluster. This data drives an adaptive question selection system that targets student weaknesses, offering various selection modes, auto-difficulty adjustment, and progressive relaxation for filtering.

## Authentication & Sessions
Supabase Auth handles primary authentication using JWT-based sessions and RLS. It supports Email/Password and Google OAuth, includes an under-13 consent gate for FERPA compliance, and enforces role-based access control (student/admin/guardian).

## Guardian (Parent) Profile System
The Guardian feature enables parents to monitor their child's SAT prep progress through unique link codes, a dedicated dashboard displaying student activity and accuracy, and bidirectional unlink functionality. Durable rate limiting and automatic profile creation are implemented.

## Account System
Every user has an associated Lyceon account for billing and entitlement tracking. This involves tables for accounts, memberships, entitlements, and daily usage, with helper functions for managing these entities and checking usage limits.

## Guardian Subscription & Billing
Parent access to student monitoring features requires a paid subscription integrated with Stripe for schema management and webhook processing. Billing routes, a paywall component, and configurable pricing tiers are implemented, supporting multiple accounts for guardians.

## Canonical Practice System
All practice flows use a unified canonical API with deterministic question selection and no repeats within a session. A single `use-adaptive-practice.ts` hook provides core functionality. Database hardening ensures unique constraints, efficient indexing, RLS, and foreign key integrity.

## Calendar & Study Planning
The calendar system provides LLM-generated personalized study plans based on student weaknesses using Gemini 2.0-flash, featuring timezone handling, completion tracking, and streak calculation.

## Score Projection
The score projection engine estimates SAT scores using College Board domain weights with recency decay and calculates a confidence interval.

## Weekly & Recency KPIs
The KPI system provides real-time performance metrics for the dashboard, including weekly KPIs (practice sessions, questions solved, accuracy for the last 7 local days) and recency KPIs (last 200 attempts statistics).

## Date/Time Handling Conventions
All date bucketing uses Luxon IANA timezone patterns to ensure correct local day boundaries, avoiding UTC-based string manipulations. The user's timezone is fetched from `user_preferences.timezone`.

## Dashboard Architecture
The dashboard is entirely deterministic, sourcing all UI values from calendar and progress APIs, displaying today's focus, score projection, and weekly KPIs.



# External Dependencies

## Core Infrastructure
*   **Supabase**: PostgreSQL database, RLS, pgvector.
*   **Google Gemini API**: AI provider for text generation and embeddings.
*   **@google-cloud/documentai**: OCR processing.

## UI Libraries
*   **React**: Frontend framework.
*   **Wouter**: Routing library.
*   **TanStack React Query**: Server state management.
*   **Tailwind CSS**: Utility-first CSS framework.
*   **shadcn/ui**: Component library.
*   **Radix UI**: Headless UI components.
*   **Framer Motion**: Animation library.
*   **Lucide Icons**: Icon library.

## Build & Development
*   **Vite**: Frontend build tool.
*   **ESBuild**: Backend bundling.
*   **TypeScript**: Full-stack static type checking.

## Backend Libraries
*   **Node.js**: Backend runtime.
*   **Express.js**: Web framework.
*   **Multer**: Multipart form data handling.
*   **Helmet**: Express middleware for security headers.

## Other
*   **Supabase JS Client**: Database operations.