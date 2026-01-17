import { motion } from "framer-motion";
import { TrendingUp, TrendingDown } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  trend?: string;
  trendUp?: boolean;
  index?: number;
}

export default function StatCard({ title, value, trend, trendUp = true, index = 0 }: StatCardProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      className="p-6 bg-white/80 backdrop-blur-md rounded-2xl shadow-lg hover:shadow-xl transition-shadow" 
      data-testid={`stat-${title.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <h3 className="text-sm text-neutral-600 mb-2" data-testid="stat-title">{title}</h3>
      <div className="flex items-end justify-between">
        <p className="text-3xl font-semibold text-lyceon-primary" data-testid="stat-value">{value}</p>
        {trend && (
          <div className={`flex items-center gap-1 text-sm ${trendUp ? 'text-green-600' : 'text-red-600'}`} data-testid="stat-trend">
            {trendUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            <span>{trend}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
