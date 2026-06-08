-- Seed 0003: SAT Taxonomy Data
-- Inserts reference data for SAT domains, skills, and difficulty levels
-- No PII or user data

-- Note: This seed assumes a basic setup. For the full SAT Learning Copilot,
-- question data comes from PDF processing, not from seeds.

-- Insert sample difficulty tags (if you want enum-like validation)
-- These can be used for filtering and analytics

-- Create a reference table for SAT sections (optional, for validation)
CREATE TABLE IF NOT EXISTS sat_sections_ref (
  section TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT
);

INSERT INTO sat_sections_ref (section, display_name, description) VALUES
  ('Math', 'Mathematics', 'Algebra, Advanced Math, Problem-Solving, Geometry & Trigonometry'),
  ('Reading', 'Reading & Writing', 'Reading Comprehension, Vocabulary in Context, Command of Evidence'),
  ('Writing', 'Writing & Language', 'Expression of Ideas, Standard English Conventions')
ON CONFLICT (section) DO NOTHING;

-- Create a reference table for difficulty levels
CREATE TABLE IF NOT EXISTS difficulty_levels_ref (
  level TEXT PRIMARY KEY,
  numeric_value INTEGER NOT NULL,
  description TEXT
);

INSERT INTO difficulty_levels_ref (level, numeric_value, description) VALUES
  ('Easy', 1, 'Foundation level questions'),
  ('Medium', 2, 'Standard difficulty'),
  ('Hard', 3, 'Advanced problem-solving required')
ON CONFLICT (level) DO NOTHING;

-- Create a reference table for common SAT math topics/units
CREATE TABLE IF NOT EXISTS sat_math_topics_ref (
  topic TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT
);

INSERT INTO sat_math_topics_ref (topic, category, description) VALUES
  ('Algebra', 'Math', 'Linear equations, systems, inequalities'),
  ('Functions', 'Math', 'Function notation, transformations, modeling'),
  ('Geometry', 'Math', 'Angles, triangles, circles, area, volume'),
  ('Trigonometry', 'Math', 'Right triangle trig, unit circle, identities'),
  ('Data Analysis', 'Math', 'Statistics, probability, data interpretation'),
  ('Advanced Math', 'Math', 'Quadratics, exponentials, polynomials, radicals')
ON CONFLICT (topic) DO NOTHING;

-- Create a reference table for Reading & Writing skills
CREATE TABLE IF NOT EXISTS sat_rw_skills_ref (
  skill TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT
);

INSERT INTO sat_rw_skills_ref (skill, category, description) VALUES
  ('Reading Comprehension', 'Reading', 'Understanding main ideas and details'),
  ('Vocabulary in Context', 'Reading', 'Determining word meanings from context'),
  ('Command of Evidence', 'Reading', 'Finding textual support for conclusions'),
  ('Standard Conventions', 'Writing', 'Grammar, punctuation, sentence structure'),
  ('Expression of Ideas', 'Writing', 'Organization, development, effective language use')
ON CONFLICT (skill) DO NOTHING;

COMMENT ON TABLE sat_sections_ref IS 'SAT section reference data';
COMMENT ON TABLE difficulty_levels_ref IS 'SAT difficulty level reference';
COMMENT ON TABLE sat_math_topics_ref IS 'SAT math topic taxonomy';
COMMENT ON TABLE sat_rw_skills_ref IS 'SAT reading & writing skills taxonomy';
