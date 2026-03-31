import { csrfFetch } from "./csrf";

export interface LegalDocSection {
  id: string;
  title: string;
  content: string;
}

export interface LegalDoc {
  slug: string;
  docKey: string;
  title: string;
  shortDescription: string;
  pdfPath: string;
  lastUpdated: string;
  sections: LegalDocSection[];
}

export const legalDocs: LegalDoc[] = [
  {
    slug: 'trust-and-safety',
    docKey: 'trust_and_safety',
    title: 'Trust & Safety at Lyceon',
    shortDescription: 'How we approach trust, safety, and responsibility in AI-powered learning.',
    pdfPath: '/legal/Trust-and-Safety-at-Lyceon.pdf',
    lastUpdated: '2024-12-22',
    sections: [
      {
        id: 'intro',
        title: 'Introduction',
        content: `At Lyceon, we believe technology should strengthen learning, not replace it. That's why we've built the platform with a safety-first, integrity-driven foundation, designed to support students while protecting families and educators.

This page provides a high-level overview of how we approach trust, safety, and responsibility. Full details are always available in our policies below.`
      },
      {
        id: 'academic-integrity',
        title: '1. Academic Integrity First',
        content: `We don't do the work for students. We help students understand the work.

**Concept-First Learning**
Lyceon's AI is designed to guide thinking through hints, explanations, and feedback. It does not exist to simply hand over answers or complete assignments.

**Honor Code Commitment**
Every student agrees to our Honor Code, which requires using Lyceon as a supplemental learning tool and never as a way to bypass school rules, assignments, or exams.

Our goal is to build better learners, not shortcuts.`
      },
      {
        id: 'privacy-security',
        title: '2. Privacy & Data Security',
        content: `Your data supports learning. It is never treated as a product.

**No Data Selling**
Lyceon does not sell personal information to third parties.

**No Targeted Advertising**
Student data is never used to build advertising profiles or marketing audiences.

**Secure Infrastructure**
We use industry-standard security practices, including encryption, access controls, and monitoring, to protect accounts and learning progress.

Privacy is a core part of trust, not an afterthought.`
      },
      {
        id: 'responsible-ai',
        title: '3. Responsible AI Use',
        content: `Transparent, supervised, and safety-aware by design.

**Human-in-the-Loop**
Students are encouraged to think critically and report AI responses that seem inaccurate, misleading, or inappropriate.

**Layered Safety Filters**
We use multiple safety mechanisms to reduce the risk of harmful, explicit, or biased AI output.

**Training Protection**
When third-party AI services are used, they are contractually prohibited from using personal data to train public or general-purpose models.

AI is a tool for learning, not an authority.`
      },
      {
        id: 'parent-guardian',
        title: '4. Parent & Guardian Peace of Mind',
        content: `Designed for families, not just students.

**Parental Agreement**
Students under 18 may only use Lyceon with parent or guardian consent.

**Transparency & Control**
Parents have the right to review, correct, or request deletion of their child's data, subject to applicable law.

**Age-Gated Access**
Lyceon is designed exclusively for users aged 13 and older, in alignment with global child protection standards.

We view parents as partners in the learning process.`
      },
      {
        id: 'community',
        title: '5. A Respectful Learning Community',
        content: `Focused, professional, and safe.

**Zero Tolerance for Bullying**
Harassment, impersonation, and inappropriate behavior are strictly prohibited under our Community Guidelines.

**Proactive Monitoring**
We use a combination of automated systems and human review to identify and address violations of our safety standards.

Lyceon is a learning environment, not a social free-for-all.`
      },
      {
        id: 'contact',
        title: 'Contact',
        content: `Questions about trust or safety?
Contact our Trust & Safety Team at: support@lyceon.ai`
      }
    ]
  },
  {
    slug: 'community-guidelines',
    docKey: 'community_guidelines',
    title: 'Lyceon Community Guidelines',
    shortDescription: 'How users are expected to behave when using Lyceon.',
    pdfPath: '/legal/Lyceon-Community-Guidelines.pdf',
    lastUpdated: '2024-12-22',
    sections: [
      {
        id: 'intro',
        title: 'Introduction',
        content: `Lyceon is a learning environment built on respect, safety, and trust. These Community Guidelines explain how users are expected to behave when using Lyceon.

These guidelines apply to all interactions on the platform, including:
- AI chat and tutoring features
- Messages, feedback, or submissions
- Any current or future community, leaderboard, or social features

By using Lyceon, you agree to follow these guidelines.`
      },
      {
        id: 'respectful',
        title: '1. Be Respectful and Authentic',
        content: `Treat others with respect and honesty.

You must not:
- Harass, bully, threaten, or intimidate others
- Use hateful, discriminatory, or abusive language
- Target individuals or groups based on personal characteristics
- Impersonate other users, Lyceon employees, tutors, moderators, or representatives
- Misrepresent your identity or role on the platform

Lyceon is for learning, not deception or harassment.`
      },
      {
        id: 'content',
        title: '2. Keep Content Appropriate and Safe',
        content: `All content and interactions must be appropriate for a student learning environment.

You must not:
- Share explicit, sexual, or violent content
- Promote self-harm or dangerous behavior
- Post content that is intentionally misleading or harmful
- Share real-world personal contact information, including:
  - Phone numbers
  - Home addresses
  - Social media handles
  - Messaging app usernames (e.g., Discord, Snapchat, WhatsApp)

Do not overshare personal information in any public or AI-facing areas of the platform.`
      },
      {
        id: 'ai-use',
        title: '3. Use AI Responsibly',
        content: `Lyceon uses AI to support learning, not to replace judgment.

You must not:
- Attempt to bypass or manipulate AI safety systems
- Use prompt engineering to generate disallowed or unsafe content
- Encourage the AI to produce harmful, deceptive, or inappropriate responses
- Treat AI output as authoritative without critical thinking

If you encounter unsafe, misleading, or inappropriate AI behavior, report it.`
      },
      {
        id: 'cheating',
        title: '4. No Cheating or Academic Misuse',
        content: `You must not:
- Use Lyceon during live, official, or proctored exams
- Use Lyceon to complete assignments intended to reflect your own work
- Share answers or explanations to gain unfair academic advantage

Lyceon exists to support learning, not to undermine academic integrity.`
      },
      {
        id: 'platform',
        title: '5. Protect the Platform',
        content: `You must not:
- Scrape, copy, or redistribute Lyceon content without permission
- Reverse engineer, exploit, or interfere with platform systems
- Attempt to bypass safeguards, limits, or monitoring
- Use Lyceon in ways that disrupt service for others`
      },
      {
        id: 'report',
        title: '6. Report Issues',
        content: `If you encounter:
- Harassment or abuse
- Unsafe or inappropriate content
- Misuse of AI tools
- Behavior that violates these guidelines

You should report it through the platform or designated support channels. Reporting helps keep Lyceon safe and effective for everyone.`
      },
      {
        id: 'enforcement',
        title: '7. Enforcement and Monitoring',
        content: `Violations of these Community Guidelines may result in:
- Content removal
- Warnings
- Temporary suspension
- Permanent account termination

To help maintain a safe learning environment, Lyceon may use automated systems and human review to monitor activity and enforce these guidelines.

Lyceon reserves the right to enforce these rules at its discretion to protect users and the platform.`
      },
      {
        id: 'updates',
        title: '8. Updates to These Guidelines',
        content: `Lyceon may update these Community Guidelines as the platform evolves.

Continued use of Lyceon after updates constitutes acceptance of the revised guidelines.`
      }
    ]
  },
  {
    slug: 'privacy-policy',
    docKey: 'privacy_policy',
    title: 'Lyceon Privacy Policy',
    shortDescription: 'How we collect, use, store, share, and protect information.',
    pdfPath: '/legal/Lyceon-Privacy-Policy.pdf',
    lastUpdated: '2024-12-22',
    sections: [
      {
        id: 'intro',
        title: 'Introduction',
        content: `Lyceon respects your privacy and is committed to protecting personal data. This Privacy Policy explains how we collect, use, store, share, and protect information when students and parents use the Lyceon platform.

This policy applies to:
- Students using Lyceon
- Parents or guardians providing consent
- Visitors to the Lyceon website or app

By using Lyceon, you agree to this Privacy Policy.`
      },
      {
        id: 'collect',
        title: '1. Information We Collect',
        content: `We collect only the information necessary to operate, improve, and secure the platform.

**1.1 Information You Provide**
This may include:
- Name or username
- Email address
- Account credentials
- Parent or guardian contact information (for minors)
- Messages, responses, or feedback submitted through the platform

**1.2 Learning and Usage Data**
To personalize learning, we collect:
- Answers submitted to questions
- Progress and performance data
- Time spent on activities
- Interaction patterns with explanations and AI tools

**1.3 Technical and Device Data**
We may collect:
- Device type and browser
- IP address
- Log data and error reports
- Cookies or similar technologies for functionality and security`
      },
      {
        id: 'use',
        title: '2. How We Use Information',
        content: `We use collected data to:
- Provide and operate the Lyceon platform
- Personalize learning experiences
- Improve explanations, content quality, and difficulty targeting
- Monitor platform performance and security
- Prevent abuse, cheating, or misuse
- Communicate important updates or notices

We do not use personal data for targeted advertising.`
      },
      {
        id: 'ai',
        title: '3. AI and Data Usage',
        content: `Lyceon uses artificial intelligence to support learning and personalization.

**3.1 AI Personalization**
Learning data may be used to:
- Adapt explanations and hints
- Adjust difficulty levels
- Improve clarity and instructional effectiveness

**3.2 Model Improvement**
Lyceon may analyze data in aggregated, anonymized, or pseudonymized form to:
- Improve platform quality
- Enhance AI accuracy, safety, and reliability

Lyceon does not sell personal data.`
      },
      {
        id: 'children',
        title: '4. Children\'s Privacy',
        content: `Lyceon is intended for users 13 years of age or older.

Lyceon does not knowingly collect personal data from children under 13.

If we become aware that personal data has been collected from a child under 13:
- The account will be suspended or terminated
- The data will be deleted in accordance with applicable law

Parents or guardians may contact Lyceon to request access to or deletion of a child's data.`
      },
      {
        id: 'share',
        title: '5. How We Share Information',
        content: `Lyceon shares information only when necessary to operate the platform and comply with the law.

**5.1 Service Providers and Sub-Processors**
We may share information with trusted service providers that help us operate Lyceon, such as:
- Cloud hosting providers
- Analytics and monitoring services
- Payment processors
- Third-party AI service providers used to generate learning content

When using third-party AI services:
- Data shared is anonymized or pseudonymized where reasonably possible
- Providers act as sub-processors and process data only on Lyceon's instructions
- Providers are contractually prohibited from using student data to train their own public or general-purpose models

**5.2 Legal and Safety Reasons**
We may disclose information if required to:
- Comply with legal obligations
- Respond to lawful requests
- Protect the rights, safety, or security of Lyceon, users, or others

Lyceon does not sell personal information.`
      },
      {
        id: 'retention',
        title: '6. Data Retention and Account Deletion',
        content: `We retain personal data only as long as necessary to:
- Provide services
- Meet legal and regulatory obligations
- Resolve disputes
- Enforce agreements

**6.1 Account Deletion**
If a user deletes their account or requests deletion:
- Personal account data will be deleted or anonymized within a reasonable timeframe, subject to legal requirements

If a student is associated with a class, school, or organization:
- Certain learning records may be retained as part of the teacher's or institution's educational records
- Retained data will not be used for marketing and will be handled in accordance with this Privacy Policy`
      },
      {
        id: 'security',
        title: '7. Data Security and Breach Notification',
        content: `Lyceon uses reasonable administrative, technical, and organizational safeguards to protect personal data, including:
- Secure authentication
- Access controls
- Monitoring and logging

No system is completely secure. However, we take data protection seriously and continuously improve our safeguards.

In the event of a data breach that compromises personal information, Lyceon will notify affected users and/or parents in accordance with applicable legal requirements.`
      },
      {
        id: 'rights',
        title: '8. User Rights and Choices',
        content: `Depending on your location, you may have rights to:
- Access your personal data
- Correct inaccurate data
- Request deletion of data
- Restrict or object to certain processing

Parents or guardians may exercise these rights on behalf of minors.

Requests can be submitted using the contact information below.`
      },
      {
        id: 'cookies',
        title: '9. Cookies and Tracking Technologies',
        content: `Lyceon may use cookies or similar technologies to:
- Keep users logged in
- Maintain platform functionality
- Improve reliability and performance

You can control cookies through your browser settings, though some features may not function properly if disabled.`
      },
      {
        id: 'international',
        title: '10. International Users',
        content: `Lyceon is operated from the United States.

If you access Lyceon from outside the U.S., you acknowledge that your information may be transferred to and processed in jurisdictions with different data protection laws.`
      },
      {
        id: 'changes',
        title: '11. Changes to This Privacy Policy',
        content: `Lyceon may update this Privacy Policy from time to time.

If changes are material, we will provide notice through the platform or other reasonable means. Continued use of Lyceon constitutes acceptance of the updated policy.`
      },
      {
        id: 'contact',
        title: '12. Contact Information',
        content: `For questions, concerns, or data requests, contact:

Email: hello@lyceon.ai
Company: Lyceon`
      }
    ]
  },
  {
    slug: 'honor-code',
    docKey: 'honor_code',
    title: 'Lyceon Honor Code',
    shortDescription: 'Our commitment to honest learning and academic integrity.',
    pdfPath: '/legal/Lyceon-Honor-Code.pdf',
    lastUpdated: '2024-12-22',
    sections: [
      {
        id: 'intro',
        title: 'Introduction',
        content: `Lyceon is built to help students learn honestly, think critically, and grow with integrity. By using Lyceon, you agree to follow this Honor Code.

This Honor Code applies to all students using the platform.`
      },
      {
        id: 'learn-honestly',
        title: '1. Learn Honestly',
        content: `Lyceon is a learning tool, not a shortcut.

You agree to:
- Use Lyceon to understand concepts, not to avoid learning
- Make a genuine effort to think through problems
- Ask for explanations when you are confused, not answers to submit as your own work

Learning happens when you engage, not when you copy.`
      },
      {
        id: 'academic-integrity',
        title: '2. Respect Academic Integrity',
        content: `You agree not to use Lyceon in ways that violate school, instructor, or testing rules.

This includes:
- Using Lyceon during live, official, or proctored exams
- Submitting AI-generated content as your own work unless explicitly allowed
- Using Lyceon to complete essays, assignments, or responses intended for grading

Different schools have different rules. You are responsible for knowing and following yours. Lyceon is not responsible for academic consequences resulting from misuse of the platform.`
      },
      {
        id: 'ai-responsibly',
        title: '3. Use AI Responsibly',
        content: `Lyceon uses artificial intelligence to support learning. AI is a tool, not an authority.

You agree to:
- Treat AI explanations as guidance, not guaranteed truth
- Think critically about AI-generated responses
- Verify understanding rather than blindly trusting outputs

You agree not to:
- Attempt to manipulate or bypass AI safety systems
- Use prompt engineering to elicit disallowed or unsafe content
- Encourage the AI to provide harmful, deceptive, or inappropriate responses`
      },
      {
        id: 'respectful',
        title: '4. Be Respectful',
        content: `Lyceon is a learning environment.

You agree to:
- Treat others with respect
- Communicate appropriately and constructively
- Avoid harassment, bullying, or abusive behavior

You may not:
- Use hateful, threatening, or explicit language
- Target or intimidate other users
- Misuse any social or interactive features`
      },
      {
        id: 'platform',
        title: '5. Respect the Platform',
        content: `Lyceon is protected software.

You agree not to:
- Copy, scrape, or redistribute Lyceon content
- Reverse engineer or exploit the platform
- Attempt to bypass safeguards, limits, or monitoring systems

Respecting the platform ensures it remains safe and effective for everyone.`
      },
      {
        id: 'report',
        title: '6. Report Problems',
        content: `If you encounter:
- Inappropriate AI behavior
- Harassment or abuse
- Content that feels unsafe or misleading

You agree to report it through the platform or designated support channels.

Reporting helps improve Lyceon for everyone.`
      },
      {
        id: 'consequences',
        title: '7. Consequences of Violations',
        content: `Violating this Honor Code may result in:
- Warnings
- Temporary suspension
- Permanent removal from the platform

Serious or repeated violations may lead to immediate termination of access.`
      },
      {
        id: 'commitment',
        title: '8. A Shared Commitment',
        content: `By using Lyceon, you commit to:
- Learning honestly
- Acting responsibly
- Respecting others and the platform

This Honor Code exists to protect students, learning, and trust.`
      }
    ]
  },
  {
    slug: 'student-terms',
    docKey: 'student_terms',
    title: 'Lyceon Student Terms of Use',
    shortDescription: 'The terms that govern your access to and use of Lyceon.',
    pdfPath: '/legal/Lyceon-Student-Terms-of-Use.pdf',
    lastUpdated: '2024-12-20',
    sections: [
      {
        id: 'intro',
        title: 'Introduction',
        content: `Welcome to Lyceon. These Student Terms of Use ("Terms") govern your access to and use of the Lyceon platform. By accessing or using Lyceon, you agree to these Terms. If you do not agree, you may not use the platform.

If you are under 18 years old, your parent or legal guardian must also agree to the Lyceon Parent / Guardian Terms on your behalf.`
      },
      {
        id: 'what-is-lyceon',
        title: '1. What Lyceon Is',
        content: `Lyceon is an educational platform designed to support learning through practice questions, explanations, and guided feedback.

Lyceon:
- Is a supplemental learning tool
- Helps students understand concepts and mistakes
- Supports independent study and preparation

Lyceon is not:
- An official testing organization
- A replacement for teachers, tutors, or schools
- A guarantee of any academic or test outcome`
      },
      {
        id: 'eligibility',
        title: '2. Eligibility and Age Requirements',
        content: `Lyceon is intended only for users who are 13 years of age or older.

By creating or using an account, you represent and warrant that:
- You are at least 13 years old
- The age information you provide is accurate

Lyceon does not knowingly permit users under the age of 13 to use the platform.

If Lyceon becomes aware that an account belongs to a user under 13:
- The account will be immediately suspended or terminated
- Associated personal data will be deleted in accordance with applicable law

Lyceon does not currently offer verified parental consent flows for users under 13. Any future changes will be clearly disclosed.`
      },
      {
        id: 'account',
        title: '3. Your Account',
        content: `**3.1 Account Responsibility**
- You may create only one account unless explicitly permitted
- You are responsible for maintaining the confidentiality of your login credentials
- You are responsible for all activity that occurs under your account

**3.2 Account Misuse**
You may not:
- Share your account with others
- Access or attempt to access accounts that are not yours
- Bypass usage limits, safeguards, or security features

Lyceon reserves the right to suspend or terminate accounts for misuse.`
      },
      {
        id: 'acceptable-use',
        title: '4. Acceptable Use and Academic Integrity',
        content: `You may use Lyceon to:
- Practice questions
- Learn and review academic concepts
- Understand explanations and feedback
- Prepare responsibly for exams

You may not use Lyceon to:
- Cheat or gain unfair academic advantage
- Use the platform during live, official, or proctored exams
- Copy, scrape, or redistribute Lyceon content without permission

**4.1 Academic Integrity and AI Use**
Lyceon is designed to explain concepts and support learning, not to complete academic work on your behalf.

You may not:
- Generate or rewrite essays, assignments, or responses intended to be submitted as your own work
- Present AI-generated content as original work without explicit permission from your school or instructor
- Use Lyceon to bypass academic integrity policies

Lyceon is not responsible for academic consequences resulting from misuse of the platform, including plagiarism findings, disciplinary action, or sanctions.`
      },
      {
        id: 'honor-code',
        title: '5. Honor Code',
        content: `All students using Lyceon must follow the Lyceon Honor Code.

By using the platform, you agree to:
- Learn honestly
- Respect academic integrity
- Use Lyceon to understand concepts, not shortcut learning
- Follow all platform rules and guidelines

Violations of the Honor Code may result in suspension or permanent removal from the platform.`
      },
      {
        id: 'ai-tutor',
        title: '6. AI Tutor, Safety, and Reporting',
        content: `Some content on Lyceon, including explanations, hints, feedback, and suggested approaches, is generated or assisted by artificial intelligence.

You understand and agree that:
- AI-generated content may be inaccurate, incomplete, biased, offensive, or inappropriate
- AI responses are probabilistic and not guaranteed to be correct
- AI-generated content is not professional, academic, or personal advice

You are responsible for evaluating and using AI-generated content appropriately.

If you encounter AI behavior that is harmful, misleading, or inappropriate, you agree to report it through the platform or designated support channels.

To the fullest extent permitted by law, Lyceon is not liable for:
- Emotional distress
- Stress or anxiety
- Academic penalties or disciplinary actions
- Loss of opportunity arising from reliance on AI-generated content.`
      },
      {
        id: 'no-guarantees',
        title: '7. No Guarantees',
        content: `Lyceon does not guarantee:
- Test score improvements
- Academic performance outcomes
- College admissions, scholarships, or placements

Your results depend on many factors outside Lyceon's control, including effort, prior knowledge, and study habits.`
      },
      {
        id: 'content-ip',
        title: '8. Content and Intellectual Property',
        content: `**8.1 Lyceon Content**
All software, designs, explanations, AI systems, and materials provided by Lyceon are owned by Lyceon or its licensors.

You are granted a limited, personal, non-transferable license to use Lyceon content for educational purposes only.

**8.2 Your Content**
You retain ownership of content you submit, such as answers or messages.

By using Lyceon, you grant Lyceon a license to:
- Store and display your content
- Operate and improve the platform
- Analyze content in aggregated or anonymized form`
      },
      {
        id: 'privacy',
        title: '9. Privacy',
        content: `Your use of Lyceon is governed by the Lyceon Privacy Policy.

Lyceon collects and uses data to:
- Personalize learning
- Improve platform quality
- Maintain safety and reliability

If you are a minor, your data is handled with additional care. Parents or guardians may request access or deletion as described in the Privacy Policy.`
      },
      {
        id: 'prohibited',
        title: '10. Prohibited Conduct',
        content: `You agree not to:
- Harass, bully, threaten, or abuse other users
- Share hateful, explicit, or harmful content
- Attempt to manipulate or bypass AI safety systems ("jailbreaking")
- Use prompt engineering to elicit disallowed or unsafe outputs
- Reverse engineer, scrape, or exploit the platform

Lyceon may monitor usage patterns to enforce safety and integrity.

Violations may result in suspension or permanent termination.`
      },
      {
        id: 'billing',
        title: '11. Subscriptions, Billing, and Refunds',
        content: `Lyceon may offer free and paid subscription plans.

If you enroll in a paid plan:
- Fees are billed in advance on a recurring basis
- Subscriptions may automatically renew unless canceled
- You are responsible for all charges on your account

Unless otherwise stated:
- Fees are non-refundable
- No refunds are provided for partial billing periods

Lyceon reserves the right to change pricing or features with reasonable notice.`
      },
      {
        id: 'suspension',
        title: '12. Account Suspension and Termination',
        content: `Lyceon may suspend or terminate your account if you:
- Violate these Terms
- Violate the Honor Code
- Abuse the platform or other users
- Engage in unlawful or harmful behavior

Termination may result in loss of access to content and progress data.`
      },
      {
        id: 'liability',
        title: '13. Limitation of Liability',
        content: `TO THE MAXIMUM EXTENT PERMITTED BY LAW, LYCEON AND ITS AFFILIATES SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, CONSEQUENTIAL, SPECIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF ACADEMIC OPPORTUNITY, EXAM FEES, EXPECTED SCORE IMPROVEMENTS, OR FUTURE EARNINGS.

THE SERVICE IS PROVIDED ON AN 'AS IS' AND 'AS AVAILABLE' BASIS.

LYCEON'S TOTAL LIABILITY FOR ANY CLAIM ARISING OUT OF OR RELATING TO THE PLATFORM SHALL NOT EXCEED THE GREATER OF:
- THE AMOUNT YOU PAID TO LYCEON IN THE TWELVE (12) MONTHS PRIOR TO THE CLAIM, OR
- FIFTY U.S. DOLLARS ($50)`
      },
      {
        id: 'arbitration',
        title: '14. Arbitration and Class Action Waiver',
        content: `You agree that any dispute arising out of or relating to Lyceon shall be resolved through binding arbitration, rather than in court, except where prohibited by law.

You agree to bring claims only on an individual basis and waive any right to participate in a class action, collective action, or representative proceeding.

This provision survives termination of your account.`
      },
      {
        id: 'changes',
        title: '15. Changes to These Terms',
        content: `Lyceon may update these Terms from time to time. Continued use of the platform after changes constitutes acceptance of the updated Terms.`
      },
      {
        id: 'contact',
        title: '16. Contact Information',
        content: `If you have questions about these Terms, you may contact Lyceon at:

Email: hello@lyceon.ai
Company: Lyceon AI`
      }
    ]
  },
  {
    slug: 'parent-guardian-terms',
    docKey: 'parent_guardian_terms',
    title: 'Lyceon Parent / Guardian Terms',
    shortDescription: 'Terms for parents or guardians providing consent for minors.',
    pdfPath: '/legal/Lyceon-Parent-Guardian-Terms.pdf',
    lastUpdated: '2024-12-22',
    sections: [
      {
        id: 'intro',
        title: 'Introduction',
        content: `These Parent / Guardian Terms ("Parent Terms") apply when a parent or legal guardian ("you") provides consent for a minor to use the Lyceon platform.

By allowing your child to use Lyceon, you agree to these Parent Terms, the Student Terms of Use, the Privacy Policy, and the Honor Code. If you do not agree, your child may not use the platform.`
      },
      {
        id: 'role',
        title: '1. Role of the Parent or Guardian',
        content: `By providing consent, you represent and agree that:
- You are the parent or legal guardian of the minor using Lyceon
- You have the legal authority to provide consent on the child's behalf
- You are responsible for the child's use of the platform

You acknowledge that Lyceon is not a substitute for parental supervision, classroom instruction, or professional tutoring.

**1.1 Duty to Monitor**
You agree to periodically review your child's activity on Lyceon to ensure that they are using the platform safely, responsibly, and in accordance with the Student Terms, Honor Code, and applicable school or testing rules.`
      },
      {
        id: 'educational',
        title: '2. Educational Purpose Disclaimer',
        content: `Lyceon is an educational support tool intended to supplement learning.

You acknowledge that:
- Lyceon does not provide certified instruction
- Lyceon does not guarantee academic outcomes, test scores, or admissions results
- Learning outcomes depend on many factors outside Lyceon's control

You remain responsible for academic decisions, study strategies, and exam registration.`
      },
      {
        id: 'age',
        title: '3. Age Eligibility and Child Protection',
        content: `Lyceon is intended only for users 13 years of age or older.

Lyceon does not knowingly collect personal data from children under 13.

If Lyceon becomes aware that a child under 13 has created an account:
- The account will be immediately suspended or terminated
- Associated data will be deleted in accordance with applicable law

Lyceon does not currently offer verified parental consent mechanisms for users under 13.`
      },
      {
        id: 'ai-content',
        title: '4. AI-Generated Content, Accuracy, and Safety',
        content: `Lyceon uses artificial intelligence to generate explanations, hints, feedback, and learning guidance.

You acknowledge and agree that:
- AI-generated content may be inaccurate, incomplete, biased, offensive, or inappropriate
- AI systems may "hallucinate," meaning they can confidently present false or misleading information
- AI-generated content is probabilistic and not guaranteed to be correct
- AI-generated content is not professional, academic, medical, or legal advice

You acknowledge that you have discussed these limitations with your child and encouraged them to think critically about AI-generated content.

Lyceon encourages reporting of inappropriate or harmful AI behavior so it can be reviewed and improved.

To the fullest extent permitted by law, Lyceon is not liable for:
- Emotional distress
- Academic penalties or disciplinary actions
- Stress, anxiety, or loss of opportunity resulting from reliance on AI-generated content.`
      },
      {
        id: 'academic-integrity',
        title: '5. Academic Integrity and Misuse',
        content: `Lyceon is designed to explain concepts and support learning, not to complete academic work on behalf of students.

You acknowledge that:
- Schools, instructors, and testing authorities may restrict or prohibit AI-assisted work
- Misuse of AI tools may result in academic consequences

Lyceon is not responsible for consequences arising from a child's misuse of the platform, including plagiarism determinations, disciplinary action, or academic sanctions.`
      },
      {
        id: 'account-responsibility',
        title: '6. Account Responsibility',
        content: `You acknowledge that:
- You are responsible for all activity conducted by your child on Lyceon
- Account credentials should be kept secure
- Only one account per student is permitted unless explicitly authorized

Lyceon reserves the right to suspend or terminate accounts that violate platform rules, the Student Terms, or the Honor Code.`
      },
      {
        id: 'payments',
        title: '7. Payments, Subscriptions, and Billing Responsibility',
        content: `If you purchase a paid subscription for your child:
- You authorize Lyceon to charge the payment method you provide
- Subscriptions may renew automatically unless canceled
- You are responsible for all charges incurred on the account

Unless otherwise stated:
- Fees are non-refundable
- No refunds are provided for partial billing periods

Lyceon may modify pricing, plans, or features with reasonable notice.`
      },
      {
        id: 'data-privacy',
        title: '8. Data Collection and Privacy',
        content: `Lyceon collects student data to:
- Personalize learning
- Track progress
- Improve platform quality and safety

Student data may include learning activity, performance metrics, and usage patterns.

All data handling is governed by the Lyceon Privacy Policy.

As a parent or guardian, you may request access to, correction of, or deletion of your child's data, subject to legal requirements.`
      },
      {
        id: 'content-ownership',
        title: '9. Content Ownership',
        content: `Your child retains ownership of content they submit to Lyceon.

By consenting to use of the platform, you grant Lyceon a license to:
- Store and display submitted content
- Operate and improve the platform
- Analyze content in aggregated or anonymized form

Lyceon retains ownership of all platform software, content, and AI systems.`
      },
      {
        id: 'prohibited',
        title: '10. Prohibited Conduct',
        content: `You agree that your child may not:
- Harass, bully, or abuse other users
- Share hateful, explicit, or harmful content
- Attempt to bypass or manipulate AI safety systems
- Reverse engineer, scrape, or exploit the platform

Lyceon may monitor usage patterns to enforce safety and integrity.

Violations may result in suspension or permanent termination.`
      },
      {
        id: 'indemnification',
        title: '11. Indemnification',
        content: `You agree to defend, indemnify, and hold harmless Lyceon and its affiliates from and against any claims, damages, losses, liabilities, or expenses (including reasonable legal fees) arising out of or related to:
- Your child's violation of these Parent Terms
- Your child's violation of the Student Terms or Honor Code
- Content or actions taken by your child on the platform`
      },
      {
        id: 'liability',
        title: '12. Limitation of Liability',
        content: `TO THE MAXIMUM EXTENT PERMITTED BY LAW, LYCEON SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, CONSEQUENTIAL, SPECIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF ACADEMIC OPPORTUNITY, EXAM FEES, EXPECTED SCORE IMPROVEMENTS, OR FUTURE EARNINGS.

LYCEON'S TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE PLATFORM SHALL NOT EXCEED THE GREATER OF:
- THE AMOUNT YOU PAID TO LYCEON IN THE TWELVE (12) MONTHS PRIOR TO THE CLAIM, OR
- FIFTY U.S. DOLLARS ($50)`
      },
      {
        id: 'arbitration',
        title: '13. Arbitration and Class Action Waiver',
        content: `You agree that any dispute arising out of or relating to Lyceon shall be resolved through binding arbitration, rather than in court, except where prohibited by law.

You waive any right to bring or participate in a class action, collective action, or representative proceeding.

This provision survives termination.`
      },
      {
        id: 'changes',
        title: '14. Changes to These Terms',
        content: `Lyceon may update these Parent Terms from time to time. Continued use of the platform after changes constitutes acceptance of the updated Terms.`
      },
      {
        id: 'contact',
        title: '15. Contact Information',
        content: `For questions regarding these Parent Terms, contact:

Email: hello@lyceon.ai
Company: Lyceon`
      }
    ]
  }
];

export function getLegalDocBySlug(slug: string): LegalDoc | undefined {
  return legalDocs.find(doc => doc.slug === slug);
}

export function getLegalDocByKey(docKey: string): LegalDoc | undefined {
  return legalDocs.find(doc => doc.docKey === docKey);
}

export interface LegalAcceptance {
  docKey: string;
  docVersion: string;
  actorType: 'student' | 'parent';
  minor: boolean;
}

export async function recordAcceptance(
  acceptance: LegalAcceptance
): Promise<{ success: boolean; error?: string }> {
  try {
    const resp = await csrfFetch("/api/legal/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(acceptance),
    });

    const data = await resp.json();
    if (!resp.ok) return { success: false, error: data?.error || "Failed to record acceptance" };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || "Unknown error" };
  }
}

export async function fetchUserAcceptances(): Promise<{
  acceptances: Array<{
    doc_key: string;
    doc_version: string;
    accepted_at: string;
    actor_type: string;
  }>;
  error?: string;
}> {
  try {
    const resp = await csrfFetch("/api/legal/acceptances", {
      method: "GET",
      credentials: "include",
    });

    const data = await resp.json();
    if (!resp.ok) return { acceptances: [], error: data?.error || "Failed to load acceptances" };

    return { acceptances: data.acceptances || [] };
  } catch (err: any) {
    return { acceptances: [], error: err?.message || "Unknown error" };
  }
}


export function hasAccepted(
  acceptances: Array<{ doc_key: string; doc_version: string }>,
  docKey: string,
  docVersion: string
): boolean {
  return acceptances.some(
    a => a.doc_key === docKey && a.doc_version === docVersion
  );
}
