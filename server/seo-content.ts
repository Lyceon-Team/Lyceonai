export interface PublicPageSeo {
  title: string;
  description: string;
  canonical: string;
  bodyHtml: string;
}

const footerHtml = `
<footer style="text-align: center; padding: 2rem 0; border-top: 1px solid #eee; color: #777; margin-top: 3rem;">
  <p>&copy; 2024 Lyceon. AI-powered SAT preparation.</p>
  <nav style="margin-top: 1rem;">
    <a href="/" style="color: #0F2E48; margin: 0 0.5rem;">Home</a>
    <a href="/digital-sat" style="color: #0F2E48; margin: 0 0.5rem;">Digital SAT</a>
    <a href="/blog" style="color: #0F2E48; margin: 0 0.5rem;">Blog</a>
    <a href="/legal/privacy-policy" style="color: #0F2E48; margin: 0 0.5rem;">Privacy Policy</a>
    <a href="/legal/student-terms" style="color: #0F2E48; margin: 0 0.5rem;">Terms of Use</a>
  </nav>
</footer>`;

export const PUBLIC_SSR_ROUTES: Record<string, PublicPageSeo> = {
  "/": {
    title: "Lyceon – AI SAT Tutor with Real Practice Questions",
    description: "Lyceon is an AI SAT tutor that uses real SAT-style questions and step-by-step explanations to help you practice smarter, track progress, and boost your score.",
    canonical: "https://lyceon.ai/",
    bodyHtml: `
<main style="font-family: system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 2rem;">
  <header style="text-align: center; margin-bottom: 3rem;">
    <h1 style="font-size: 2.5rem; margin-bottom: 1rem; color: #0F2E48;">Lyceon – AI SAT Tutor</h1>
    <p style="font-size: 1.25rem; color: #555; max-width: 600px; margin: 0 auto;">
      Practice SAT questions with an AI tutor that actually knows the test. 
      Get step-by-step explanations and track your progress.
    </p>
  </header>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">Why Lyceon?</h2>
    <ul style="list-style: none; padding: 0; display: grid; gap: 1rem;">
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Real SAT-Style Questions</strong> – Practice with questions modeled after the actual Digital SAT format.
      </li>
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>AI-Powered Tutoring</strong> – Get personalized explanations that adapt to your learning style.
      </li>
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Progress Tracking</strong> – See your improvement over time with detailed analytics.
      </li>
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Adaptive Learning</strong> – Focus on your weak areas with questions tailored to your skill level.
      </li>
    </ul>
  </section>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">How It Works</h2>
    <ol style="padding-left: 1.5rem; line-height: 1.8;">
      <li>Sign up for free – no credit card required</li>
      <li>Start a practice session in <a href="/digital-sat/math" style="color: #0F2E48;">Math</a> or <a href="/digital-sat/reading-writing" style="color: #0F2E48;">Reading & Writing</a></li>
      <li>Answer questions and get instant AI feedback</li>
      <li>Review your progress and target your weaknesses</li>
    </ol>
  </section>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">Frequently Asked Questions</h2>
    <article style="margin-bottom: 1rem;">
      <h3 style="font-size: 1.1rem; margin-bottom: 0.5rem;">Is this just ChatGPT with a different logo?</h3>
      <p style="color: #555;">No. The tutor is grounded in SAT-style questions and explanations. It retrieves specific problems and walks you through them step by step instead of giving generic answers.</p>
    </article>
    <article style="margin-bottom: 1rem;">
      <h3 style="font-size: 1.1rem; margin-bottom: 0.5rem;">Do I need a credit card to start?</h3>
      <p style="color: #555;">No. You can start a free SAT practice session without entering any payment details.</p>
    </article>
    <article style="margin-bottom: 1rem;">
      <h3 style="font-size: 1.1rem; margin-bottom: 0.5rem;">Can parents and tutors see progress?</h3>
      <p style="color: #555;">Yes. You can share a read-only dashboard view with parents, tutors, or counselors to show progress and remaining weak spots.</p>
    </article>
  </section>
  ${footerHtml}
</main>`
  },

  "/digital-sat": {
    title: "Digital SAT Practice – Free AI-Powered Prep | Lyceon",
    description: "Master the Digital SAT with Lyceon's AI tutor. Practice real SAT-style questions in Math and Reading & Writing with personalized explanations and adaptive learning.",
    canonical: "https://lyceon.ai/digital-sat",
    bodyHtml: `
<main style="font-family: system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 2rem;">
  <header style="text-align: center; margin-bottom: 3rem;">
    <h1 style="font-size: 2.5rem; margin-bottom: 1rem; color: #0F2E48;">Digital SAT Practice</h1>
    <p style="font-size: 1.25rem; color: #555; max-width: 700px; margin: 0 auto;">
      The SAT went digital in 2024. Lyceon helps you prepare with real SAT-style questions, 
      AI-powered explanations, and adaptive practice that focuses on your weak areas.
    </p>
  </header>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">Choose Your Section</h2>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem;">
      <a href="/digital-sat/math" style="text-decoration: none; color: inherit;">
        <article style="padding: 2rem; background: #f8f9fa; border-radius: 12px; border: 2px solid transparent; transition: border-color 0.2s;">
          <h3 style="font-size: 1.3rem; color: #0F2E48; margin-bottom: 0.5rem;">Math</h3>
          <p style="color: #555; margin-bottom: 1rem;">Algebra, problem-solving, data analysis, geometry, and trigonometry. The Digital SAT Math section tests your ability to solve problems efficiently.</p>
          <span style="color: #0F2E48; font-weight: 600;">Start Math Practice →</span>
        </article>
      </a>
      <a href="/digital-sat/reading-writing" style="text-decoration: none; color: inherit;">
        <article style="padding: 2rem; background: #f8f9fa; border-radius: 12px; border: 2px solid transparent; transition: border-color 0.2s;">
          <h3 style="font-size: 1.3rem; color: #0F2E48; margin-bottom: 0.5rem;">Reading & Writing</h3>
          <p style="color: #555; margin-bottom: 1rem;">Reading comprehension, grammar, vocabulary in context, and rhetorical analysis. Master the skills needed for the combined Reading and Writing section.</p>
          <span style="color: #0F2E48; font-weight: 600;">Start Reading & Writing Practice →</span>
        </article>
      </a>
    </div>
  </section>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">What Changed with the Digital SAT?</h2>
    <p style="color: #555; line-height: 1.7; margin-bottom: 1rem;">
      Starting in March 2024, the SAT moved to a fully digital format. The test is now shorter (about 2 hours instead of 3), 
      uses adaptive testing technology, and allows calculators on the entire Math section. Reading passages are also shorter, 
      with one question per passage instead of multiple questions on long texts.
    </p>
    <p style="color: #555; line-height: 1.7;">
      Lyceon's practice questions mirror the new Digital SAT format, so you know exactly what to expect on test day. 
      Our AI tutor explains each question step by step, helping you understand not just the right answer, but why it's right.
    </p>
  </section>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">How Lyceon Helps You Score Higher</h2>
    <ul style="list-style: none; padding: 0; display: grid; gap: 1rem;">
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Adaptive Practice</strong> – Our system identifies your weak areas and prioritizes questions that will help you improve fastest.
      </li>
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>AI Explanations</strong> – Don't just see the answer. Understand the reasoning with detailed, personalized explanations.
      </li>
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Progress Tracking</strong> – Watch your accuracy improve over time with clear charts and analytics.
      </li>
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>No Fluff</strong> – Jump straight into practice. No lengthy video courses or overwhelming study plans.
      </li>
    </ul>
  </section>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">Related Resources</h2>
    <ul style="padding-left: 1.5rem; line-height: 2;">
      <li><a href="/blog/is-digital-sat-harder" style="color: #0F2E48;">Is the Digital SAT Harder Than the Paper SAT?</a></li>
      <li><a href="/blog/digital-sat-scoring-explained" style="color: #0F2E48;">Digital SAT Scoring Explained</a></li>
      <li><a href="/blog/quick-sat-study-routine" style="color: #0F2E48;">A Quick SAT Study Routine That Works</a></li>
    </ul>
  </section>
  ${footerHtml}
</main>`
  },

  "/digital-sat/math": {
    title: "Digital SAT Math Practice – AI Tutor | Lyceon",
    description: "Practice Digital SAT Math with Lyceon's AI tutor. Master algebra, geometry, data analysis, and problem-solving with real SAT-style questions and step-by-step explanations.",
    canonical: "https://lyceon.ai/digital-sat/math",
    bodyHtml: `
<main style="font-family: system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 2rem;">
  <header style="text-align: center; margin-bottom: 3rem;">
    <h1 style="font-size: 2.5rem; margin-bottom: 1rem; color: #0F2E48;">Digital SAT Math Practice</h1>
    <p style="font-size: 1.25rem; color: #555; max-width: 700px; margin: 0 auto;">
      Master SAT Math with AI-powered practice. Get personalized explanations for algebra, 
      geometry, data analysis, and problem-solving questions.
    </p>
  </header>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">What's on the Digital SAT Math Section?</h2>
    <p style="color: #555; line-height: 1.7; margin-bottom: 1rem;">
      The Digital SAT Math section contains 44 questions to be completed in 70 minutes. Unlike the old paper SAT, 
      you can use a calculator on all questions. The section is divided into two modules, and your performance 
      on the first module determines the difficulty of the second.
    </p>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1.5rem;">
      <div style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <h3 style="font-size: 1.1rem; color: #0F2E48; margin-bottom: 0.5rem;">Algebra</h3>
        <p style="color: #555; font-size: 0.9rem;">Linear equations, systems of equations, and inequalities</p>
      </div>
      <div style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <h3 style="font-size: 1.1rem; color: #0F2E48; margin-bottom: 0.5rem;">Advanced Math</h3>
        <p style="color: #555; font-size: 0.9rem;">Quadratics, polynomials, and exponential functions</p>
      </div>
      <div style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <h3 style="font-size: 1.1rem; color: #0F2E48; margin-bottom: 0.5rem;">Problem-Solving</h3>
        <p style="color: #555; font-size: 0.9rem;">Ratios, rates, percentages, and data analysis</p>
      </div>
      <div style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <h3 style="font-size: 1.1rem; color: #0F2E48; margin-bottom: 0.5rem;">Geometry & Trig</h3>
        <p style="color: #555; font-size: 0.9rem;">Area, volume, lines, angles, and basic trigonometry</p>
      </div>
    </div>
  </section>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">How Lyceon Helps with Math</h2>
    <ul style="list-style: none; padding: 0; display: grid; gap: 1rem;">
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Step-by-Step Solutions</strong> – Every question includes a detailed explanation showing each step of the solution process.
      </li>
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Weakness Targeting</strong> – Struggling with quadratics? Our system will prioritize those questions until you master them.
      </li>
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Multiple Approaches</strong> – Learn different ways to solve the same problem so you can choose the fastest method on test day.
      </li>
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Calculator Tips</strong> – Learn when to use your calculator and when mental math is faster.
      </li>
    </ul>
  </section>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">Common SAT Math Mistakes to Avoid</h2>
    <p style="color: #555; line-height: 1.7; margin-bottom: 1rem;">
      Many students lose points not because they don't know the math, but because of careless errors. 
      Lyceon's AI tutor helps you recognize these patterns: misreading negative signs, forgetting to 
      distribute, mixing up formulas, and rushing through word problems.
    </p>
    <p style="color: #555; line-height: 1.7;">
      Read our guide on <a href="/blog/common-sat-math-algebra-mistakes" style="color: #0F2E48;">Common SAT Math Algebra Mistakes</a> 
      to learn what to watch out for.
    </p>
  </section>
  
  <nav style="text-align: center; margin-bottom: 3rem;">
    <a href="/digital-sat" style="color: #0F2E48; margin-right: 1rem;">← Back to Digital SAT</a>
    <a href="/digital-sat/reading-writing" style="color: #0F2E48;">Try Reading & Writing →</a>
  </nav>
  ${footerHtml}
</main>`
  },

  "/digital-sat/reading-writing": {
    title: "Digital SAT Reading & Writing Practice – AI Tutor | Lyceon",
    description: "Practice Digital SAT Reading & Writing with Lyceon's AI tutor. Master reading comprehension, grammar, vocabulary, and rhetorical analysis with personalized explanations.",
    canonical: "https://lyceon.ai/digital-sat/reading-writing",
    bodyHtml: `
<main style="font-family: system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 2rem;">
  <header style="text-align: center; margin-bottom: 3rem;">
    <h1 style="font-size: 2.5rem; margin-bottom: 1rem; color: #0F2E48;">Digital SAT Reading & Writing Practice</h1>
    <p style="font-size: 1.25rem; color: #555; max-width: 700px; margin: 0 auto;">
      Master the combined Reading and Writing section with AI-powered practice. 
      Improve your comprehension, grammar, and vocabulary with personalized feedback.
    </p>
  </header>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">What's on the Digital SAT Reading & Writing Section?</h2>
    <p style="color: #555; line-height: 1.7; margin-bottom: 1rem;">
      The Digital SAT combines Reading and Writing into one section with 54 questions in 64 minutes. 
      Each question is paired with a short passage (25-150 words), making it faster to read and answer. 
      Like the Math section, it uses adaptive testing across two modules.
    </p>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1.5rem;">
      <div style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <h3 style="font-size: 1.1rem; color: #0F2E48; margin-bottom: 0.5rem;">Craft & Structure</h3>
        <p style="color: #555; font-size: 0.9rem;">Word choice, text structure, and purpose</p>
      </div>
      <div style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <h3 style="font-size: 1.1rem; color: #0F2E48; margin-bottom: 0.5rem;">Information & Ideas</h3>
        <p style="color: #555; font-size: 0.9rem;">Main ideas, details, and inferences</p>
      </div>
      <div style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <h3 style="font-size: 1.1rem; color: #0F2E48; margin-bottom: 0.5rem;">Standard English</h3>
        <p style="color: #555; font-size: 0.9rem;">Grammar, punctuation, and sentence structure</p>
      </div>
      <div style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <h3 style="font-size: 1.1rem; color: #0F2E48; margin-bottom: 0.5rem;">Expression of Ideas</h3>
        <p style="color: #555; font-size: 0.9rem;">Transitions, organization, and effective language</p>
      </div>
    </div>
  </section>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">How Lyceon Helps with Reading & Writing</h2>
    <ul style="list-style: none; padding: 0; display: grid; gap: 1rem;">
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Passage Analysis</strong> – Learn to quickly identify the main idea, tone, and structure of any passage.
      </li>
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Grammar Rules</strong> – Master the specific grammar rules the SAT tests, from comma usage to subject-verb agreement.
      </li>
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Vocabulary in Context</strong> – Build your understanding of how words function in different contexts.
      </li>
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Evidence-Based Answers</strong> – Learn to find textual evidence that supports your answer choice.
      </li>
    </ul>
  </section>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">Tips for the Digital Format</h2>
    <p style="color: #555; line-height: 1.7; margin-bottom: 1rem;">
      The digital format changes how you interact with passages. You can highlight text on screen, 
      flag questions to return to later, and use the built-in annotation tools. Lyceon's practice 
      environment mimics these features so you're comfortable on test day.
    </p>
    <p style="color: #555; line-height: 1.7;">
      With shorter passages and one question per text, you can move faster through the section. 
      But don't let speed make you careless – read each passage carefully before looking at the question.
    </p>
  </section>
  
  <nav style="text-align: center; margin-bottom: 3rem;">
    <a href="/digital-sat" style="color: #0F2E48; margin-right: 1rem;">← Back to Digital SAT</a>
    <a href="/digital-sat/math" style="color: #0F2E48;">Try Math Practice →</a>
  </nav>
  ${footerHtml}
</main>`
  },

  "/blog": {
    title: "SAT Prep Blog – Tips, Strategies & Insights | Lyceon",
    description: "Expert SAT prep advice, study strategies, and insights from Lyceon. Learn how to improve your SAT score with practical tips for the Digital SAT.",
    canonical: "https://lyceon.ai/blog",
    bodyHtml: `
<main style="font-family: system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 2rem;">
  <header style="text-align: center; margin-bottom: 3rem;">
    <h1 style="font-size: 2.5rem; margin-bottom: 1rem; color: #0F2E48;">Lyceon Blog</h1>
    <p style="font-size: 1.25rem; color: #555; max-width: 600px; margin: 0 auto;">
      SAT prep tips, study strategies, and insights to help you score higher.
    </p>
  </header>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1.5rem;">Latest Articles</h2>
    <div style="display: grid; gap: 1.5rem;">
      <article style="padding: 1.5rem; background: #f8f9fa; border-radius: 12px;">
        <h3 style="font-size: 1.2rem; margin-bottom: 0.5rem;"><a href="/blog/is-digital-sat-harder" style="color: #0F2E48; text-decoration: none;">Is the Digital SAT Harder Than the Paper SAT?</a></h3>
        <p style="color: #555; margin-bottom: 0.5rem;">Breaking down the differences between the old paper SAT and the new Digital SAT format. What changed, and how does it affect your score?</p>
        <a href="/blog/is-digital-sat-harder" style="color: #0F2E48; font-weight: 600;">Read more →</a>
      </article>
      
      <article style="padding: 1.5rem; background: #f8f9fa; border-radius: 12px;">
        <h3 style="font-size: 1.2rem; margin-bottom: 0.5rem;"><a href="/blog/digital-sat-scoring-explained" style="color: #0F2E48; text-decoration: none;">Digital SAT Scoring Explained</a></h3>
        <p style="color: #555; margin-bottom: 0.5rem;">How does the Digital SAT calculate your score? Understanding the adaptive testing model and what it means for your preparation.</p>
        <a href="/blog/digital-sat-scoring-explained" style="color: #0F2E48; font-weight: 600;">Read more →</a>
      </article>
      
      <article style="padding: 1.5rem; background: #f8f9fa; border-radius: 12px;">
        <h3 style="font-size: 1.2rem; margin-bottom: 0.5rem;"><a href="/blog/quick-sat-study-routine" style="color: #0F2E48; text-decoration: none;">A Quick SAT Study Routine That Works</a></h3>
        <p style="color: #555; margin-bottom: 0.5rem;">Don't have hours to study? Here's a focused 30-minute daily routine that can help you improve your SAT score consistently.</p>
        <a href="/blog/quick-sat-study-routine" style="color: #0F2E48; font-weight: 600;">Read more →</a>
      </article>
      
      <article style="padding: 1.5rem; background: #f8f9fa; border-radius: 12px;">
        <h3 style="font-size: 1.2rem; margin-bottom: 0.5rem;"><a href="/blog/sat-question-bank-practice" style="color: #0F2E48; text-decoration: none;">How to Use a Question Bank for SAT Practice</a></h3>
        <p style="color: #555; margin-bottom: 0.5rem;">Why practicing with real SAT-style questions is more effective than generic test prep. Tips for making the most of question bank practice.</p>
        <a href="/blog/sat-question-bank-practice" style="color: #0F2E48; font-weight: 600;">Read more →</a>
      </article>
      
      <article style="padding: 1.5rem; background: #f8f9fa; border-radius: 12px;">
        <h3 style="font-size: 1.2rem; margin-bottom: 0.5rem;"><a href="/blog/common-sat-math-algebra-mistakes" style="color: #0F2E48; text-decoration: none;">Common SAT Math Algebra Mistakes</a></h3>
        <p style="color: #555; margin-bottom: 0.5rem;">The most common algebra errors students make on the SAT and how to avoid them. Stop losing easy points to careless mistakes.</p>
        <a href="/blog/common-sat-math-algebra-mistakes" style="color: #0F2E48; font-weight: 600;">Read more →</a>
      </article>
    </div>
  </section>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">Topics</h2>
    <div style="display: flex; flex-wrap: wrap; gap: 0.75rem;">
      <a href="/digital-sat" style="padding: 0.5rem 1rem; background: #0F2E48; color: white; border-radius: 20px; text-decoration: none; font-size: 0.9rem;">Digital SAT</a>
      <a href="/digital-sat/math" style="padding: 0.5rem 1rem; background: #f8f9fa; color: #0F2E48; border-radius: 20px; text-decoration: none; font-size: 0.9rem;">Math</a>
      <a href="/digital-sat/reading-writing" style="padding: 0.5rem 1rem; background: #f8f9fa; color: #0F2E48; border-radius: 20px; text-decoration: none; font-size: 0.9rem;">Reading & Writing</a>
    </div>
  </section>
  ${footerHtml}
</main>`
  },

  "/blog/is-digital-sat-harder": {
    title: "Is the Digital SAT Harder Than the Paper SAT? | Lyceon",
    description: "Comparing the Digital SAT to the old paper format. What changed, is it harder or easier, and how should you adjust your preparation strategy?",
    canonical: "https://lyceon.ai/blog/is-digital-sat-harder",
    bodyHtml: `
<main style="font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem;">
  <article>
    <header style="margin-bottom: 2rem;">
      <nav style="margin-bottom: 1rem;"><a href="/blog" style="color: #0F2E48;">← Back to Blog</a></nav>
      <h1 style="font-size: 2rem; margin-bottom: 1rem; color: #0F2E48;">Is the Digital SAT Harder Than the Paper SAT?</h1>
      <p style="color: #777; font-size: 0.9rem;">Updated December 2024</p>
    </header>
    
    <section style="line-height: 1.8; color: #333;">
      <p style="margin-bottom: 1.5rem;">
        When College Board announced the switch to the Digital SAT in 2024, students and parents had one big question: 
        is the new test harder? The short answer is no – but it's different, and those differences matter.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">What Changed with the Digital SAT</h2>
      <p style="margin-bottom: 1rem;">
        The Digital SAT is shorter (about 2 hours instead of 3), uses adaptive testing technology, and 
        combines Reading and Writing into one section. Passages are shorter, questions are designed differently, 
        and you can use a calculator on all math questions.
      </p>
      <p style="margin-bottom: 1.5rem;">
        The adaptive format means your performance on the first module of each section determines the difficulty 
        of the second module. This can feel different from the paper test, but the scoring is designed to be equivalent.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Is It Actually Easier or Harder?</h2>
      <p style="margin-bottom: 1rem;">
        For most students, the Digital SAT is neither harder nor easier – it's just different. The shorter passages 
        can feel less exhausting. The calculator access helps some students. The adaptive format can be stressful 
        if you know about it, but the pacing is often more manageable.
      </p>
      <p style="margin-bottom: 1.5rem;">
        The College Board calibrates scores so that a 1400 on the Digital SAT represents the same achievement level 
        as a 1400 on the old paper SAT. Your preparation should focus on the new format, but don't assume it will 
        be dramatically different in difficulty.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">How to Prepare for the Digital Format</h2>
      <p style="margin-bottom: 1rem;">
        The best preparation is practice with the actual format. Get comfortable with digital passages, timed practice 
        on a computer, and the specific question types the Digital SAT uses. Generic "SAT prep" may not address 
        the format-specific skills you need.
      </p>
      <p style="margin-bottom: 1.5rem;">
        <a href="/digital-sat" style="color: #0F2E48; font-weight: 600;">Try Lyceon's Digital SAT practice</a> to get 
        familiar with the new format and identify your weak areas before test day.
      </p>
    </section>
    
    <nav style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid #eee;">
      <p style="color: #777; margin-bottom: 1rem;">Related Articles:</p>
      <ul style="list-style: none; padding: 0;">
        <li style="margin-bottom: 0.5rem;"><a href="/blog/digital-sat-scoring-explained" style="color: #0F2E48;">Digital SAT Scoring Explained</a></li>
        <li style="margin-bottom: 0.5rem;"><a href="/blog/quick-sat-study-routine" style="color: #0F2E48;">A Quick SAT Study Routine That Works</a></li>
      </ul>
    </nav>
  </article>
  ${footerHtml}
</main>`
  },

  "/blog/digital-sat-scoring-explained": {
    title: "Digital SAT Scoring Explained – How Adaptive Testing Works | Lyceon",
    description: "Understanding how the Digital SAT calculates your score. Learn about adaptive testing, score ranges, and what your SAT score means for college admissions.",
    canonical: "https://lyceon.ai/blog/digital-sat-scoring-explained",
    bodyHtml: `
<main style="font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem;">
  <article>
    <header style="margin-bottom: 2rem;">
      <nav style="margin-bottom: 1rem;"><a href="/blog" style="color: #0F2E48;">← Back to Blog</a></nav>
      <h1 style="font-size: 2rem; margin-bottom: 1rem; color: #0F2E48;">Digital SAT Scoring Explained</h1>
      <p style="color: #777; font-size: 0.9rem;">Updated December 2024</p>
    </header>
    
    <section style="line-height: 1.8; color: #333;">
      <p style="margin-bottom: 1.5rem;">
        The Digital SAT uses adaptive testing, which means the difficulty of questions changes based on your performance. 
        This can be confusing when you're trying to understand your score. Here's how it actually works.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Score Range and Sections</h2>
      <p style="margin-bottom: 1rem;">
        Like the paper SAT, the Digital SAT is scored on a scale of 400-1600. You get a score from 200-800 for 
        the Math section and 200-800 for the Reading and Writing section. These two scores combine for your total.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">How Adaptive Testing Affects Your Score</h2>
      <p style="margin-bottom: 1rem;">
        Each section has two modules. Your performance on the first module determines whether you get a harder 
        or easier second module. Getting more difficult questions is actually a good sign – it means you did well 
        on the first module.
      </p>
      <p style="margin-bottom: 1.5rem;">
        The scoring algorithm accounts for question difficulty. A student who answers 70% of hard questions correctly 
        may score higher than someone who answers 90% of easy questions correctly. This is why you shouldn't try to 
        game the system by intentionally missing questions.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">What This Means for Your Preparation</h2>
      <p style="margin-bottom: 1rem;">
        The adaptive format rewards consistent performance across difficulty levels. Don't panic if questions 
        feel hard – that's often a sign you're doing well. Focus on accuracy rather than trying to finish quickly.
      </p>
      <p style="margin-bottom: 1.5rem;">
        <a href="/digital-sat" style="color: #0F2E48; font-weight: 600;">Practice with Lyceon</a> to experience 
        questions across different difficulty levels and build confidence with the adaptive format.
      </p>
    </section>
    
    <nav style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid #eee;">
      <p style="color: #777; margin-bottom: 1rem;">Related Articles:</p>
      <ul style="list-style: none; padding: 0;">
        <li style="margin-bottom: 0.5rem;"><a href="/blog/is-digital-sat-harder" style="color: #0F2E48;">Is the Digital SAT Harder?</a></li>
        <li style="margin-bottom: 0.5rem;"><a href="/blog/sat-question-bank-practice" style="color: #0F2E48;">How to Use a Question Bank for SAT Practice</a></li>
      </ul>
    </nav>
  </article>
  ${footerHtml}
</main>`
  },

  "/blog/quick-sat-study-routine": {
    title: "A Quick SAT Study Routine That Actually Works | Lyceon",
    description: "A practical 30-minute daily SAT study routine. Learn how to make consistent progress even with limited time, focusing on high-impact practice strategies.",
    canonical: "https://lyceon.ai/blog/quick-sat-study-routine",
    bodyHtml: `
<main style="font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem;">
  <article>
    <header style="margin-bottom: 2rem;">
      <nav style="margin-bottom: 1rem;"><a href="/blog" style="color: #0F2E48;">← Back to Blog</a></nav>
      <h1 style="font-size: 2rem; margin-bottom: 1rem; color: #0F2E48;">A Quick SAT Study Routine That Works</h1>
      <p style="color: #777; font-size: 0.9rem;">Updated December 2024</p>
    </header>
    
    <section style="line-height: 1.8; color: #333;">
      <p style="margin-bottom: 1.5rem;">
        You don't need hours of free time to improve your SAT score. Consistent, focused practice of 30 minutes 
        a day can be more effective than occasional marathon study sessions. Here's a routine that works.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">The 30-Minute Daily Routine</h2>
      <p style="margin-bottom: 1rem;"><strong>Minutes 1-5: Warm-up review</strong></p>
      <p style="margin-bottom: 1rem;">
        Spend 5 minutes reviewing questions you got wrong in your last session. Understanding your mistakes 
        prevents you from repeating them.
      </p>
      <p style="margin-bottom: 1rem;"><strong>Minutes 6-25: Focused practice</strong></p>
      <p style="margin-bottom: 1rem;">
        Answer 5-8 questions in one area (Math or Reading & Writing). Work through them carefully, reading 
        explanations for any you miss. Quality matters more than quantity.
      </p>
      <p style="margin-bottom: 1rem;"><strong>Minutes 26-30: Log and plan</strong></p>
      <p style="margin-bottom: 1.5rem;">
        Note which concepts gave you trouble. Tomorrow's warm-up will review these. This creates a feedback loop 
        that accelerates your improvement.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Why This Works</h2>
      <p style="margin-bottom: 1rem;">
        Consistency beats intensity for skill-building. Your brain consolidates learning during sleep, so daily 
        practice with review is more effective than cramming. This routine also builds habit momentum – it's easier 
        to maintain 30 minutes daily than to find 3 hours on weekends.
      </p>
      <p style="margin-bottom: 1.5rem;">
        <a href="/digital-sat" style="color: #0F2E48; font-weight: 600;">Start your daily practice with Lyceon</a> – 
        our adaptive system remembers your weak areas and helps you focus on what matters most.
      </p>
    </section>
    
    <nav style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid #eee;">
      <p style="color: #777; margin-bottom: 1rem;">Related Articles:</p>
      <ul style="list-style: none; padding: 0;">
        <li style="margin-bottom: 0.5rem;"><a href="/blog/sat-question-bank-practice" style="color: #0F2E48;">How to Use a Question Bank for SAT Practice</a></li>
        <li style="margin-bottom: 0.5rem;"><a href="/blog/common-sat-math-algebra-mistakes" style="color: #0F2E48;">Common SAT Math Algebra Mistakes</a></li>
      </ul>
    </nav>
  </article>
  ${footerHtml}
</main>`
  },

  "/blog/sat-question-bank-practice": {
    title: "How to Use a Question Bank for SAT Practice | Lyceon",
    description: "Why practicing with real SAT-style questions is essential. Learn strategies for making the most of question bank practice to improve your score efficiently.",
    canonical: "https://lyceon.ai/blog/sat-question-bank-practice",
    bodyHtml: `
<main style="font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem;">
  <article>
    <header style="margin-bottom: 2rem;">
      <nav style="margin-bottom: 1rem;"><a href="/blog" style="color: #0F2E48;">← Back to Blog</a></nav>
      <h1 style="font-size: 2rem; margin-bottom: 1rem; color: #0F2E48;">How to Use a Question Bank for SAT Practice</h1>
      <p style="color: #777; font-size: 0.9rem;">Updated December 2024</p>
    </header>
    
    <section style="line-height: 1.8; color: #333;">
      <p style="margin-bottom: 1.5rem;">
        Generic test prep workbooks often miss what makes SAT questions unique. A good question bank gives you 
        exposure to the specific style, format, and difficulty of real SAT questions. Here's how to use one effectively.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Why Question Banks Beat Textbooks</h2>
      <p style="margin-bottom: 1rem;">
        The SAT tests concepts in specific ways. Knowing algebra isn't enough – you need to recognize how the SAT 
        frames algebra problems. Question banks expose you to these patterns so test day feels familiar.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Strategies for Effective Practice</h2>
      <ul style="margin-bottom: 1.5rem; padding-left: 1.5rem;">
        <li style="margin-bottom: 0.75rem;"><strong>Work untimed first</strong> – When learning, focus on understanding rather than speed. Time yourself later.</li>
        <li style="margin-bottom: 0.75rem;"><strong>Read every explanation</strong> – Even for questions you got right. You might have gotten lucky.</li>
        <li style="margin-bottom: 0.75rem;"><strong>Track your errors</strong> – Notice patterns. Do you always miss the same type of question?</li>
        <li style="margin-bottom: 0.75rem;"><strong>Return to missed questions</strong> – A week later, try them again without looking at the answer.</li>
      </ul>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Quality Over Quantity</h2>
      <p style="margin-bottom: 1rem;">
        Answering 100 questions carelessly is less valuable than answering 20 questions carefully with full review. 
        Each question you deeply understand teaches you something about how the SAT works.
      </p>
      <p style="margin-bottom: 1.5rem;">
        <a href="/digital-sat" style="color: #0F2E48; font-weight: 600;">Lyceon's question bank</a> includes detailed 
        AI-powered explanations for every question, helping you learn from both correct and incorrect answers.
      </p>
    </section>
    
    <nav style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid #eee;">
      <p style="color: #777; margin-bottom: 1rem;">Related Articles:</p>
      <ul style="list-style: none; padding: 0;">
        <li style="margin-bottom: 0.5rem;"><a href="/blog/quick-sat-study-routine" style="color: #0F2E48;">A Quick SAT Study Routine That Works</a></li>
        <li style="margin-bottom: 0.5rem;"><a href="/blog/is-digital-sat-harder" style="color: #0F2E48;">Is the Digital SAT Harder?</a></li>
      </ul>
    </nav>
  </article>
  ${footerHtml}
</main>`
  },

  "/blog/common-sat-math-algebra-mistakes": {
    title: "Common SAT Math Algebra Mistakes to Avoid | Lyceon",
    description: "The most common algebra errors students make on the SAT Math section. Learn how to recognize and avoid these mistakes to stop losing easy points.",
    canonical: "https://lyceon.ai/blog/common-sat-math-algebra-mistakes",
    bodyHtml: `
<main style="font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem;">
  <article>
    <header style="margin-bottom: 2rem;">
      <nav style="margin-bottom: 1rem;"><a href="/blog" style="color: #0F2E48;">← Back to Blog</a></nav>
      <h1 style="font-size: 2rem; margin-bottom: 1rem; color: #0F2E48;">Common SAT Math Algebra Mistakes</h1>
      <p style="color: #777; font-size: 0.9rem;">Updated December 2024</p>
    </header>
    
    <section style="line-height: 1.8; color: #333;">
      <p style="margin-bottom: 1.5rem;">
        Many SAT Math points are lost not because students don't know algebra, but because of careless errors. 
        Here are the most common algebra mistakes and how to avoid them.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">1. Sign Errors</h2>
      <p style="margin-bottom: 1.5rem;">
        The #1 algebra mistake: losing track of negative signs. When distributing a negative, every term inside 
        the parentheses changes sign. When subtracting, you're adding a negative. Write out every step until 
        this becomes automatic.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">2. Distribution Errors</h2>
      <p style="margin-bottom: 1.5rem;">
        When you see 2(x + 3), remember to multiply both terms: 2x + 6, not 2x + 3. This seems obvious, but 
        under time pressure it's an easy slip. The SAT often includes trap answers that match common distribution errors.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">3. Equation vs. Expression Confusion</h2>
      <p style="margin-bottom: 1.5rem;">
        An equation has an equals sign; an expression doesn't. You can add the same thing to both sides of an 
        equation, but you can only simplify an expression. Make sure you know what the question is asking for.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">4. Solving for the Wrong Variable</h2>
      <p style="margin-bottom: 1.5rem;">
        The SAT loves to ask for something like "3x" instead of "x". You correctly find x = 4, but the answer 
        is 12. Always re-read the question after solving to make sure you're answering what was asked.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">5. Fraction Arithmetic</h2>
      <p style="margin-bottom: 1.5rem;">
        When adding fractions, you need a common denominator. When multiplying, you don't. When dividing, flip 
        the second fraction and multiply. These rules are simple but easy to confuse under pressure.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">How to Fix These Mistakes</h2>
      <p style="margin-bottom: 1rem;">
        Practice slowly and deliberately. When you make an error, identify exactly which step went wrong. 
        Keep an "error log" of your mistakes and review it before practice sessions.
      </p>
      <p style="margin-bottom: 1.5rem;">
        <a href="/digital-sat/math" style="color: #0F2E48; font-weight: 600;">Practice SAT Math with Lyceon</a> – 
        our AI tutor explains each solution step by step so you can catch and correct your error patterns.
      </p>
    </section>
    
    <nav style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid #eee;">
      <p style="color: #777; margin-bottom: 1rem;">Related Articles:</p>
      <ul style="list-style: none; padding: 0;">
        <li style="margin-bottom: 0.5rem;"><a href="/blog/quick-sat-study-routine" style="color: #0F2E48;">A Quick SAT Study Routine That Works</a></li>
        <li style="margin-bottom: 0.5rem;"><a href="/blog/digital-sat-scoring-explained" style="color: #0F2E48;">Digital SAT Scoring Explained</a></li>
      </ul>
    </nav>
  </article>
  ${footerHtml}
</main>`
  },

  "/legal": {
    title: "Legal & Trust | Lyceon",
    description: "Lyceon's legal policies, terms of use, privacy policy, and trust & safety information. We're committed to protecting your data and providing a safe learning environment.",
    canonical: "https://lyceon.ai/legal",
    bodyHtml: `
<main style="font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem;">
  <header style="margin-bottom: 2rem;">
    <h1 style="font-size: 2rem; margin-bottom: 1rem; color: #0F2E48;">Legal & Trust</h1>
    <p style="color: #555; line-height: 1.6;">
      Lyceon is committed to protecting your privacy, ensuring data security, and providing a safe learning 
      environment for students of all ages. Review our policies below.
    </p>
  </header>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1.5rem;">Our Policies</h2>
    <div style="display: grid; gap: 1rem;">
      <a href="/legal/privacy-policy" style="display: block; padding: 1.5rem; background: #f8f9fa; border-radius: 8px; text-decoration: none; color: inherit;">
        <h3 style="font-size: 1.2rem; color: #0F2E48; margin-bottom: 0.5rem;">Privacy Policy</h3>
        <p style="color: #555; margin: 0;">How we collect, use, and protect your personal information. Includes FERPA compliance for students under 13.</p>
      </a>
      <a href="/legal/student-terms" style="display: block; padding: 1.5rem; background: #f8f9fa; border-radius: 8px; text-decoration: none; color: inherit;">
        <h3 style="font-size: 1.2rem; color: #0F2E48; margin-bottom: 0.5rem;">Terms of Use</h3>
        <p style="color: #555; margin: 0;">The rules and guidelines for using Lyceon's services. What you can expect from us and what we expect from you.</p>
      </a>
    </div>
  </section>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">Our Commitment</h2>
    <ul style="list-style: none; padding: 0; display: grid; gap: 1rem;">
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Data Protection</strong> – We use industry-standard encryption and security practices to protect your information.
      </li>
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Student Safety</strong> – We comply with FERPA and implement age-appropriate protections for minors.
      </li>
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>Transparency</strong> – We're clear about what data we collect and how we use it.
      </li>
      <li style="padding: 1rem; background: #f8f9fa; border-radius: 8px;">
        <strong>No Selling Data</strong> – We never sell your personal information to third parties.
      </li>
    </ul>
  </section>
  
  <section style="margin-bottom: 3rem;">
    <h2 style="font-size: 1.5rem; color: #0F2E48; margin-bottom: 1rem;">Contact</h2>
    <p style="color: #555; line-height: 1.6;">
      Questions about our policies? Contact us at <a href="mailto:legal@lyceon.ai" style="color: #0F2E48;">legal@lyceon.ai</a>.
    </p>
  </section>
  ${footerHtml}
</main>`
  },

  "/legal/privacy-policy": {
    title: "Privacy Policy | Lyceon",
    description: "Lyceon's privacy policy explains how we collect, use, and protect your personal information. Includes FERPA compliance details for students under 13.",
    canonical: "https://lyceon.ai/legal/privacy-policy",
    bodyHtml: `
<main style="font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem;">
  <article>
    <header style="margin-bottom: 2rem;">
      <nav style="margin-bottom: 1rem;"><a href="/legal" style="color: #0F2E48;">← Back to Legal</a></nav>
      <h1 style="font-size: 2rem; margin-bottom: 0.5rem; color: #0F2E48;">Privacy Policy</h1>
      <p style="color: #777; font-size: 0.9rem;">Last updated: December 2024</p>
    </header>
    
    <section style="line-height: 1.8; color: #333;">
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Overview</h2>
      <p style="margin-bottom: 1.5rem;">
        Lyceon ("we," "our," or "us") is committed to protecting the privacy of our users, especially students. 
        This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use 
        our SAT preparation platform.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Information We Collect</h2>
      <p style="margin-bottom: 1rem;"><strong>Account Information:</strong> When you create an account, we collect your email address, name, and any profile information you choose to provide.</p>
      <p style="margin-bottom: 1rem;"><strong>Practice Data:</strong> We collect your answers, practice session history, and performance analytics to provide personalized learning recommendations.</p>
      <p style="margin-bottom: 1.5rem;"><strong>Usage Data:</strong> We automatically collect information about how you interact with our platform, including pages visited and features used.</p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">How We Use Your Information</h2>
      <ul style="margin-bottom: 1.5rem; padding-left: 1.5rem;">
        <li style="margin-bottom: 0.5rem;">Provide and improve our SAT preparation services</li>
        <li style="margin-bottom: 0.5rem;">Personalize your learning experience based on your performance</li>
        <li style="margin-bottom: 0.5rem;">Communicate with you about your account and our services</li>
        <li style="margin-bottom: 0.5rem;">Analyze usage patterns to improve our platform</li>
      </ul>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Student Privacy (FERPA Compliance)</h2>
      <p style="margin-bottom: 1.5rem;">
        For users under 13, we require parental consent before collecting personal information. We comply with 
        FERPA (Family Educational Rights and Privacy Act) requirements and do not share student educational records 
        without appropriate consent. Parents can review and request deletion of their child's information at any time.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Data Security</h2>
      <p style="margin-bottom: 1.5rem;">
        We use industry-standard encryption, secure data storage, and access controls to protect your information. 
        We regularly review our security practices and update them as needed.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Your Rights</h2>
      <p style="margin-bottom: 1rem;">
        You have the right to access, correct, or delete your personal information. You can also request a copy 
        of your data or opt out of certain data collection. Contact us at 
        <a href="mailto:privacy@lyceon.ai" style="color: #0F2E48;">privacy@lyceon.ai</a> to exercise these rights.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Contact Us</h2>
      <p style="margin-bottom: 1rem;">
        Questions about this Privacy Policy? Email us at <a href="mailto:privacy@lyceon.ai" style="color: #0F2E48;">privacy@lyceon.ai</a>.
      </p>
    </section>
  </article>
  ${footerHtml}
</main>`
  },

  "/legal/student-terms": {
    title: "Terms of Use | Lyceon",
    description: "Lyceon's terms of use govern your use of our SAT preparation platform. Review the rules, guidelines, and your rights as a user.",
    canonical: "https://lyceon.ai/legal/student-terms",
    bodyHtml: `
<main style="font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem;">
  <article>
    <header style="margin-bottom: 2rem;">
      <nav style="margin-bottom: 1rem;"><a href="/legal" style="color: #0F2E48;">← Back to Legal</a></nav>
      <h1 style="font-size: 2rem; margin-bottom: 0.5rem; color: #0F2E48;">Terms of Use</h1>
      <p style="color: #777; font-size: 0.9rem;">Last updated: December 2024</p>
    </header>
    
    <section style="line-height: 1.8; color: #333;">
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Agreement to Terms</h2>
      <p style="margin-bottom: 1.5rem;">
        By accessing or using Lyceon's SAT preparation platform ("Service"), you agree to be bound by these 
        Terms of Use. If you do not agree to these terms, please do not use the Service.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Description of Service</h2>
      <p style="margin-bottom: 1.5rem;">
        Lyceon provides an AI-powered SAT preparation platform featuring practice questions, explanations, 
        progress tracking, and personalized learning recommendations. The Service is designed for educational 
        purposes only.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">User Accounts</h2>
      <p style="margin-bottom: 1rem;">
        You are responsible for maintaining the confidentiality of your account credentials and for all 
        activities that occur under your account. You must notify us immediately of any unauthorized use.
      </p>
      <p style="margin-bottom: 1.5rem;">
        Users under 13 must have parental consent to create an account. Parents retain the right to review 
        and delete their child's account at any time.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Acceptable Use</h2>
      <p style="margin-bottom: 1rem;">You agree not to:</p>
      <ul style="margin-bottom: 1.5rem; padding-left: 1.5rem;">
        <li style="margin-bottom: 0.5rem;">Share or distribute practice questions or explanations outside the platform</li>
        <li style="margin-bottom: 0.5rem;">Attempt to access other users' accounts or data</li>
        <li style="margin-bottom: 0.5rem;">Use automated systems to scrape or collect content</li>
        <li style="margin-bottom: 0.5rem;">Interfere with the operation of the Service</li>
      </ul>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Intellectual Property</h2>
      <p style="margin-bottom: 1.5rem;">
        All content on the platform, including questions, explanations, and educational materials, is owned 
        by Lyceon or our licensors. You may not copy, modify, or distribute this content without permission.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Disclaimers</h2>
      <p style="margin-bottom: 1.5rem;">
        Lyceon is an educational tool and does not guarantee specific test score improvements. SAT is a 
        registered trademark of the College Board, which is not affiliated with and does not endorse Lyceon.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Changes to Terms</h2>
      <p style="margin-bottom: 1rem;">
        We may update these Terms from time to time. Continued use of the Service after changes constitutes 
        acceptance of the new terms.
      </p>
      
      <h2 style="font-size: 1.4rem; color: #0F2E48; margin: 2rem 0 1rem;">Contact</h2>
      <p style="margin-bottom: 1rem;">
        Questions? Contact us at <a href="mailto:legal@lyceon.ai" style="color: #0F2E48;">legal@lyceon.ai</a>.
      </p>
    </section>
  </article>
  ${footerHtml}
</main>`
  }
};

export function getPublicPageSeo(path: string): PublicPageSeo | null {
  return PUBLIC_SSR_ROUTES[path] || null;
}
