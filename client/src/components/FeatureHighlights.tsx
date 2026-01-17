import { BookOpen, BarChart3, Brain } from "lucide-react";

export default function FeatureHighlights() {
  const features = [
    { 
      icon: <BookOpen className="text-primary" size={24}/>, 
      title: "Adaptive Practice", 
      desc: "Smart questions based on your performance." 
    },
    { 
      icon: <BarChart3 className="text-primary" size={24}/>, 
      title: "Progress Tracking", 
      desc: "Visualize accuracy & speed over time." 
    },
    { 
      icon: <Brain className="text-primary" size={24}/>, 
      title: "AI Tutor Help", 
      desc: "Step-by-step explanations and chat guidance." 
    },
  ];

  return (
    <div className="grid md:grid-cols-3 gap-6 mt-8 max-w-4xl mx-auto" data-testid="feature-highlights">
      {features.map(f => (
        <div key={f.title} className="glass p-5 rounded-2xl shadow-lg text-center" data-testid={`feature-${f.title.toLowerCase().replace(/\s+/g, '-')}`}>
          <div className="flex justify-center mb-3">{f.icon}</div>
          <h4 className="font-semibold mb-1">{f.title}</h4>
          <p className="text-sm text-neutral-600">{f.desc}</p>
        </div>
      ))}
    </div>
  );
}
