import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { PageCard } from "@/components/common/page-card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, BookOpen, AlertCircle, Search } from "lucide-react";
import { Link } from "wouter";
import MathRenderer from "@/components/MathRenderer";
import { apiRequest } from "@/lib/queryClient";
import { normalizePracticeTopicDomains, type RawPracticeTopicDomain } from "@/lib/practice-topic-taxonomy";

interface PracticeTopics {
  sections?: Array<{
    section: string;
    label: string;
    domains?: RawPracticeTopicDomain[];
  }>;
}

interface QuestionResult {
  id: string;
  canonical_id: string | null;
  section: string;
  stem: string;
  type: string;
  options: Array<{ text: string }> | null;
  difficulty: string | null;
}

interface QuestionsResponse {
  questions: QuestionResult[];
  count: number;
  filters: {
    section: string | null;
    domain: string | null;
    limit: number;
  };
}

const ALL_SECTIONS = "__all_sections__";
const ALL_DOMAINS = "__all_domains__";
const ALL_SKILLS = "__all_skills__";

function BrowseTopics() {
  const [selectedSection, setSelectedSection] = useState<string>("");
  const [selectedDomain, setSelectedDomain] = useState<string>("");
  const [selectedSkill, setSelectedSkill] = useState<string>("");
  const [selectedLimit, setSelectedLimit] = useState<string>("10");
  const [hasSearched, setHasSearched] = useState(false);

  // Fetch topics taxonomy
  const { data: topicsData, isLoading: topicsLoading, error: topicsError } = useQuery<PracticeTopics>({
    queryKey: ['/api/practice/topics'],
  });

  // Build query parameters for questions
  const buildQueryParams = () => {
    const params = new URLSearchParams();
    if (selectedSection) params.append('section', selectedSection);
    if (selectedDomain) params.append('domain', selectedDomain);
    if (selectedSkill) params.append('skill', selectedSkill);
    if (selectedLimit) params.append('limit', selectedLimit);
    return params.toString();
  };

  // Fetch filtered questions (only when user clicks search)
  const { 
    data: questionsData, 
    isLoading: questionsLoading, 
    error: questionsError,
    refetch: searchQuestions 
  } = useQuery<QuestionsResponse>({
    queryKey: ['/api/practice/questions', { 
      section: selectedSection, 
      domain: selectedDomain, 
      skill: selectedSkill, 
      limit: selectedLimit 
    }],
    queryFn: async () => {
      const query = buildQueryParams();
      const endpoint = query ? `/api/practice/questions?${query}` : '/api/practice/questions';
      const response = await apiRequest(endpoint);
      return response.json();
    },
    enabled: false, // Don't auto-fetch, only on manual search
  });

  // Get available domains for selected section
  const availableDomains = selectedSection
    ? normalizePracticeTopicDomains(topicsData?.sections?.find(s => s.section === selectedSection)?.domains)
    : [];

  // Get available skills for selected domain
  const availableSkills = selectedDomain
    ? availableDomains.find((d) => d.domain === selectedDomain)?.skills || []
    : [];

  const handleSearch = () => {
    setHasSearched(true);
    searchQuestions();
  };

  const handleReset = () => {
    setSelectedSection("");
    setSelectedDomain("");
    setSelectedSkill("");
    setSelectedLimit("10");
    setHasSearched(false);
  };

  return (
    <AppShell>
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/practice">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Practice
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Browse Practice Topics</h1>
            <p className="text-muted-foreground">
              Filter questions by section, domain, and skill
            </p>
          </div>
        </div>

        {/* Filters Card */}
        <PageCard title="Filter Questions" description="Select your preferences to find practice questions">
          {topicsLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : topicsError ? (
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span>Failed to load topics. Please try again.</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Section Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Section</label>
                <Select value={selectedSection || ALL_SECTIONS} onValueChange={(value) => {
                  setSelectedSection(value === ALL_SECTIONS ? "" : value);
                  setSelectedDomain(""); // Reset domain when section changes
                  setSelectedSkill(""); // Reset skill when section changes
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a section..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_SECTIONS}>All Sections</SelectItem>
                    {topicsData?.sections?.map((section) => (
                      <SelectItem key={section.section} value={section.section}>
                        {section.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Domain Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Domain</label>
                <Select 
                  value={selectedDomain || ALL_DOMAINS}
                  onValueChange={(value) => {
                    setSelectedDomain(value === ALL_DOMAINS ? "" : value);
                    setSelectedSkill(""); // Reset skill when domain changes
                  }}
                  disabled={!selectedSection}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={selectedSection ? "Select a domain..." : "Select a section first"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_DOMAINS}>All Domains</SelectItem>
                    {availableDomains.map((domain) => (
                      <SelectItem key={domain.domain} value={domain.domain}>
                        {domain.domain}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Skill Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Skill (Optional)</label>
                <Select 
                  value={selectedSkill || ALL_SKILLS}
                  onValueChange={(value) => setSelectedSkill(value === ALL_SKILLS ? "" : value)}
                  disabled={!selectedDomain}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={selectedDomain ? "Select a skill..." : "Select a domain first"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_SKILLS}>All Skills</SelectItem>
                    {availableSkills.map((skill) => (
                      <SelectItem key={skill} value={skill}>
                        {skill}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Limit Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Number of Questions</label>
                <Select value={selectedLimit} onValueChange={setSelectedLimit}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 questions</SelectItem>
                    <SelectItem value="10">10 questions</SelectItem>
                    <SelectItem value="15">15 questions</SelectItem>
                    <SelectItem value="20">20 questions</SelectItem>
                    <SelectItem value="30">30 questions</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <Button 
                  onClick={handleSearch} 
                  className="flex-1"
                  disabled={!selectedSection}
                >
                  <Search className="h-4 w-4 mr-2" />
                  Search Questions
                </Button>
                <Button 
                  onClick={handleReset} 
                  variant="outline"
                  disabled={!selectedSection && !selectedDomain && !selectedSkill}
                >
                  Reset
                </Button>
              </div>
            </div>
          )}
        </PageCard>

        {/* Results Section */}
        {hasSearched && (
          <div className="mt-8">
            {questionsLoading ? (
              <PageCard title="Loading Results...">
                <div className="space-y-4">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              </PageCard>
            ) : questionsError ? (
              <PageCard title="Error">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-5 w-5" />
                  <span>Failed to load questions. Please try again.</span>
                </div>
              </PageCard>
            ) : questionsData && questionsData.questions.length === 0 ? (
              <PageCard title="No Results">
                <div className="text-center py-8">
                  <BookOpen className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-xl font-semibold mb-2">No Questions Found</h3>
                  <p className="text-muted-foreground mb-6">
                    Try adjusting your filters to see more results.
                  </p>
                  <Button onClick={handleReset} variant="outline">
                    Reset Filters
                  </Button>
                </div>
              </PageCard>
            ) : questionsData ? (
              <PageCard 
                title={`Found ${questionsData.count} Question${questionsData.count !== 1 ? 's' : ''}`}
                description={`${selectedSection ? topicsData?.sections?.find(s => s.section === selectedSection)?.label : 'All sections'}${selectedDomain ? ` • ${selectedDomain}` : ''}${selectedSkill ? ` • ${selectedSkill}` : ''}`}
              >
                <div className="space-y-4">
                  {questionsData.questions.map((question, index) => (
                    <Card key={question.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="space-y-3">
                          {/* Question Header */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="secondary">Q{index + 1}</Badge>
                            <Badge variant="outline">{question.section}</Badge>
                            {question.type && (
                              <Badge variant="outline">{question.type === 'mc' ? 'Multiple Choice' : 'Free Response'}</Badge>
                            )}
                            {question.difficulty && (
                              <Badge variant="secondary">{question.difficulty}</Badge>
                            )}
                          </div>

                          {/* Question Stem */}
                          <div className="text-sm">
                            <MathRenderer content={question.stem} displayMode={false} />
                          </div>

                          {/* Options Preview (for MC questions) */}
                          {question.type === 'mc' && question.options && question.options.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {question.options.length} answer choices available
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Info Note */}
                <div className="mt-6 p-4 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    <strong>Note:</strong> These are practice question previews. To practice with full explanations and progress tracking, 
                    use the <Link href="/practice/math" className="underline">section practice</Link> or{' '}
                    <Link href="/practice/random" className="underline">mixed practice</Link> modes.
                  </p>
                </div>
              </PageCard>
            ) : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default BrowseTopics;
