import { motion } from "framer-motion";

export default function DemoDashboardPreview() {
  const stats = [
    { label: "Accuracy", value: "88%" },
    { label: "Avg Time per Q", value: "52 s" },
    { label: "Sessions", value: "12" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="glass p-6 rounded-2xl shadow-lg grid md:grid-cols-3 gap-4 max-w-3xl mx-auto"
      data-testid="demo-dashboard-preview"
    >
      {stats.map(s => (
        <div key={s.label} className="text-center" data-testid={`stat-${s.label.toLowerCase().replace(/\s+/g, '-')}`}>
          <div className="text-3xl font-semibold text-primary">{s.value}</div>
          <div className="text-sm text-neutral-600">{s.label}</div>
        </div>
      ))}
    </motion.div>
  );
}
