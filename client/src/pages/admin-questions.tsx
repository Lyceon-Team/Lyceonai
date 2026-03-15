import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Edit, Trash2, Search, RefreshCw, ArrowLeft, Filter, X } from "lucide-react";
import { Link } from "wouter";
import { SafeBoundary } from '@/components/common/SafeBoundary';
import { AdminGuard } from "@/components/auth/AdminGuard";

interface Question {
  id: string;
  stem: string;
  options: Array<{ key: string; text: string }>;
  answer: string;
  explanation?: string;
  section: string;
  difficulty: string;
  documentId: string;
  documentName: string;
  pageNumber?: number;
  questionNumber: number;
  createdAt: string;
}

interface QuestionFilters {
  section: string;
  difficulty: string;
  includeUnvalidated: boolean;
  search: string;
}

export default function AdminQuestions() {
  const { toast } = useToast();
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [filters, setFilters] = useState<QuestionFilters>({
    section: "all",
    difficulty: "all", 
    includeUnvalidated: true, // Changed to true to match new backend default behavior
    search: ""
  });

  // Fetch questions query
  const { data: questions, isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/questions", filters.includeUnvalidated],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("limit", "200");
      // Always send the includeUnvalidated parameter to be explicit
      params.append("includeUnvalidated", filters.includeUnvalidated.toString());
      
      const response = await fetch(`/api/admin/questions?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch questions");
      }
      return response.json() as Promise<Question[]>;
    }
  });

  // Filter questions based on filters
  const filteredQuestions = questions?.filter(question => {
    const matchesSection = filters.section === "all" || question.section === filters.section;
    const matchesDifficulty = filters.difficulty === "all" || question.difficulty === filters.difficulty;
    const matchesSearch = filters.search === "" || 
      question.stem.toLowerCase().includes(filters.search.toLowerCase()) ||
      question.documentName.toLowerCase().includes(filters.search.toLowerCase());
    
    return matchesSection && matchesDifficulty && matchesSearch;
  }) || [];

  // Update question mutation
  const updateQuestionMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Question> }) => {
      const response = await fetch(`/api/admin/questions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update question");
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Question updated",
        description: "Question has been successfully updated."
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/questions"] });
      setIsEditDialogOpen(false);
      setEditingQuestion(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Delete question mutation
  const deleteQuestionMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/admin/questions/${id}`, {
        method: "DELETE"
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete question");
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Question deleted",
        description: "Question has been permanently deleted."
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/questions"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Deletion failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleEditQuestion = (question: Question) => {
    setEditingQuestion(question);
    setIsEditDialogOpen(true);
  };

  const handleUpdateQuestion = (updates: Partial<Question>) => {
    if (!editingQuestion) return;
    
    updateQuestionMutation.mutate({
      id: editingQuestion.id,
      updates
    });
  };

  const handleDeleteQuestion = (id: string) => {
    deleteQuestionMutation.mutate(id);
  };

  const clearFilters = () => {
    setFilters({
      section: "all",
      difficulty: "all",
      includeUnvalidated: true, // Changed to match new default behavior
      search: ""
    });
  };

  const activeFiltersCount = Object.values(filters).filter((value, index) => {
    if (index === 0) return value !== "all"; // section
    if (index === 1) return value !== "all"; // difficulty  
    if (index === 2) return value === true; // includeUnvalidated
    if (index === 3) return value !== ""; // search
    return false;
  }).length;

  return (
    <SafeBoundary fallback={<div className="p-6">Admin page failed to load.</div>}>
      <AdminGuard>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="outline" asChild data-testid="button-back-dashboard">
              <Link href="/">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Question Admin</h1>
              <p className="text-gray-600 dark:text-gray-300">Manage and edit questions directly</p>
            </div>
          </div>
          
          <Button onClick={() => refetch()} disabled={isLoading} data-testid="button-refresh">
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Filter className="w-5 h-5" />
                Filters
                {activeFiltersCount > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {activeFiltersCount} active
                  </Badge>
                )}
              </CardTitle>
              {activeFiltersCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
                  <X className="w-4 h-4 mr-2" />
                  Clear All
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="search">Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="search"
                    placeholder="Search questions or documents..."
                    value={filters.search}
                    onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                    className="pl-10"
                    data-testid="input-search"
                  />
                </div>
              </div>
              
              <div>
                <Label htmlFor="section">Section</Label>
                <Select value={filters.section} onValueChange={(value) => setFilters(prev => ({ ...prev, section: value }))}>
                  <SelectTrigger data-testid="select-section">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sections</SelectItem>
                    <SelectItem value="Math">Math</SelectItem>
                    <SelectItem value="Reading">Reading</SelectItem>
                    <SelectItem value="Writing">Writing</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="difficulty">Difficulty</Label>
                <Select value={filters.difficulty} onValueChange={(value) => setFilters(prev => ({ ...prev, difficulty: value }))}>
                  <SelectTrigger data-testid="select-difficulty">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Difficulties</SelectItem>
                    <SelectItem value="Easy">Easy</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="Hard">Hard</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center space-x-2 pt-6">
                <input
                  type="checkbox"
                  id="includeUnvalidated"
                  checked={filters.includeUnvalidated}
                  onChange={(e) => setFilters(prev => ({ ...prev, includeUnvalidated: e.target.checked }))}
                  className="rounded border-gray-300"
                  data-testid="checkbox-include-unvalidated"
                />
                <Label htmlFor="includeUnvalidated">Include Unvalidated</Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results Summary */}
        <div className="mb-4">
          <p className="text-gray-600 dark:text-gray-300">
            Showing {filteredQuestions.length} of {questions?.length || 0} questions
          </p>
        </div>

        {/* Questions Grid */}
        {isLoading ? (
          <div className="text-center py-8">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4" />
            <p>Loading questions...</p>
          </div>
        ) : filteredQuestions.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">No questions found matching your filters.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredQuestions.map((question) => (
              <Card key={question.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" data-testid={`badge-section-${question.id}`}>
                          {question.section}
                        </Badge>
                        <Badge variant="secondary" data-testid={`badge-difficulty-${question.id}`}>
                          {question.difficulty}
                        </Badge>
                        <span className="text-sm text-gray-500">
                          Q{question.questionNumber} • {question.documentName}
                        </span>
                      </div>
                      
                      <div className="space-y-2">
                        <p className="text-lg font-medium leading-relaxed" data-testid={`question-stem-${question.id}`}>
                          {question.stem}
                        </p>
                        
                        {question.options && question.options.length > 0 && (
                          <div className="grid grid-cols-2 gap-2 mt-3">
                            {question.options.map((option) => (
                              <div
                                key={option.key}
                                className={`p-2 rounded border text-sm ${
                                  option.key === question.answer
                                    ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-200"
                                    : "bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700"
                                }`}
                              >
                                <span className="font-medium">{option.key}.</span> {option.text}
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {question.explanation && (
                          <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm dark:bg-blue-900/20 dark:border-blue-800">
                            <p className="font-medium text-blue-800 dark:text-blue-200 mb-1">Explanation:</p>
                            <p className="text-blue-700 dark:text-blue-300">{question.explanation}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex gap-2 ml-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditQuestion(question)}
                        data-testid={`button-edit-${question.id}`}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" data-testid={`button-delete-${question.id}`}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Question</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete this question? This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDeleteQuestion(question.id)}
                              className="bg-red-600 hover:bg-red-700"
                              data-testid={`button-confirm-delete-${question.id}`}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Edit Question Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Question</DialogTitle>
            </DialogHeader>
            
            {editingQuestion && (
              <EditQuestionForm 
                question={editingQuestion}
                onSubmit={handleUpdateQuestion}
                onCancel={() => setIsEditDialogOpen(false)}
                isLoading={updateQuestionMutation.isPending}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
      </AdminGuard>
    </SafeBoundary>
  );
}

// Separate component for editing questions
interface EditQuestionFormProps {
  question: Question;
  onSubmit: (updates: Partial<Question>) => void;
  onCancel: () => void;
  isLoading: boolean;
}

function EditQuestionForm({ question, onSubmit, onCancel, isLoading }: EditQuestionFormProps) {
  const [formData, setFormData] = useState({
    stem: question.stem || "",
    answer: question.answer || "",
    explanation: question.explanation || "",
    section: question.section || "",
    difficulty: question.difficulty || "",
    options: question.options || []
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleOptionChange = (index: number, field: 'key' | 'text', value: string) => {
    const newOptions = [...formData.options];
    newOptions[index] = { ...newOptions[index], [field]: value };
    setFormData(prev => ({ ...prev, options: newOptions }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="section">Section</Label>
          <Select value={formData.section} onValueChange={(value) => setFormData(prev => ({ ...prev, section: value }))}>
            <SelectTrigger data-testid="edit-select-section">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Math">Math</SelectItem>
              <SelectItem value="Reading">Reading</SelectItem>
              <SelectItem value="Writing">Writing</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="difficulty">Difficulty</Label>
          <Select value={formData.difficulty} onValueChange={(value) => setFormData(prev => ({ ...prev, difficulty: value }))}>
            <SelectTrigger data-testid="edit-select-difficulty">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Easy">Easy</SelectItem>
              <SelectItem value="Medium">Medium</SelectItem>
              <SelectItem value="Hard">Hard</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="stem">Question Text</Label>
        <Textarea
          id="stem"
          value={formData.stem}
          onChange={(e) => setFormData(prev => ({ ...prev, stem: e.target.value }))}
          rows={4}
          className="resize-none"
          data-testid="edit-textarea-stem"
        />
      </div>

      {formData.options.length > 0 && (
        <div>
          <Label>Answer Options</Label>
          <div className="space-y-3 mt-2">
            {formData.options.map((option, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-1">
                  <Input
                    value={option.key}
                    onChange={(e) => handleOptionChange(index, 'key', e.target.value)}
                    className="text-center"
                    data-testid={`edit-input-option-key-${index}`}
                  />
                </div>
                <div className="col-span-11">
                  <Input
                    value={option.text}
                    onChange={(e) => handleOptionChange(index, 'text', e.target.value)}
                    placeholder="Option text"
                    data-testid={`edit-input-option-text-${index}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <Label htmlFor="answer">Correct Answer</Label>
        <Input
          id="answer"
          value={formData.answer}
          onChange={(e) => setFormData(prev => ({ ...prev, answer: e.target.value }))}
          placeholder="e.g., A"
          data-testid="edit-input-answer"
        />
      </div>

      <div>
        <Label htmlFor="explanation">Explanation (Optional)</Label>
        <Textarea
          id="explanation"
          value={formData.explanation}
          onChange={(e) => setFormData(prev => ({ ...prev, explanation: e.target.value }))}
          rows={3}
          className="resize-none"
          data-testid="edit-textarea-explanation"
        />
      </div>

      <div className="flex justify-end gap-3">
        <DialogClose asChild>
          <Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel-edit">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={isLoading} data-testid="button-save-question">
          {isLoading ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}