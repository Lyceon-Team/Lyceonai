import { useState, useMemo, useEffect } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Flame, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface GuardianCalendarDay {
  day_date: string;
  planned_minutes: number;
  completed_minutes: number | null;
  status: string | null;
  focus: Array<{ section: string; weight: number }> | null;
  attempt_count: number;
  accuracy: number | null;
  avg_seconds_per_question: number | null;
}

interface GuardianCalendarResponse {
  days: GuardianCalendarDay[];
  streak: { current: number; longest: number };
  requestId: string;
}

type DayStatus = "planned" | "missed" | "in_progress" | "complete";

interface CalendarDay {
  dateKey: string;
  day: number;
  isCurrentMonth: boolean;
  plannedMin: number;
  completedMin: number;
  status: DayStatus;
  pct: number;
  attemptCount: number;
  accuracy: number | null;
}

function getStatusBadge(status: DayStatus, completedMin: number, plannedMin: number): { label: string; className: string } {
  switch (status) {
    case "planned":
      return { label: "Planned", className: "bg-muted text-muted-foreground" };
    case "missed":
      return { label: "Missed", className: "bg-red-100 text-red-700" };
    case "in_progress":
      return { label: "In Progress", className: "bg-teal-100 text-teal-700" };
    case "complete":
      if (completedMin > plannedMin) {
        return { label: "Exceeded", className: "bg-green-600 text-white" };
      }
      return { label: "Complete", className: "bg-teal-500 text-white" };
    default:
      return { label: "Unknown", className: "bg-muted text-muted-foreground" };
  }
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildMonthGrid(year: number, month: number): Array<{ dateKey: string; day: number; isCurrentMonth: boolean }> {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const grid: Array<{ dateKey: string; day: number; isCurrentMonth: boolean }> = [];

  for (let i = 0; i < startWeekday; i++) {
    const prevDate = new Date(year, month, -startWeekday + i + 1);
    grid.push({
      dateKey: formatDateKey(prevDate),
      day: prevDate.getDate(),
      isCurrentMonth: false,
    });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    grid.push({
      dateKey: formatDateKey(new Date(year, month, d)),
      day: d,
      isCurrentMonth: true,
    });
  }

  const remaining = 42 - grid.length;
  for (let i = 1; i <= remaining; i++) {
    const nextDate = new Date(year, month + 1, i);
    grid.push({
      dateKey: formatDateKey(nextDate),
      day: nextDate.getDate(),
      isCurrentMonth: false,
    });
  }

  return grid;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function getGuardianStudentCalendar(studentId: string, start: string, end: string): Promise<GuardianCalendarResponse> {
  const response = await fetch(`/api/guardian/students/${studentId}/calendar/month?start=${start}&end=${end}`, {
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to fetch calendar');
  }
  return response.json();
}

export default function GuardianCalendarPage() {
  const params = useParams<{ studentId: string }>();
  const studentId = params.studentId || '';
  const [, setLocation] = useLocation();

  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const monthGrid = useMemo(() => buildMonthGrid(year, month), [year, month]);

  const gridStartDate = monthGrid[0]?.dateKey ?? formatDateKey(new Date(year, month, 1));
  const gridEndDate = monthGrid[monthGrid.length - 1]?.dateKey ?? formatDateKey(new Date(year, month + 1, 0));

  const { data: studentData } = useQuery({
    queryKey: ['guardian-student-summary', studentId],
    queryFn: async () => {
      const res = await fetch(`/api/guardian/students/${studentId}/summary`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch student info');
      return res.json();
    },
    enabled: !!studentId,
  });

  const { data: calendarData, isLoading, error, refetch } = useQuery({
    queryKey: ['guardian-student-calendar', studentId, gridStartDate, gridEndDate],
    queryFn: () => getGuardianStudentCalendar(studentId, gridStartDate, gridEndDate),
    enabled: !!studentId,
  });

  const dayDataMap = useMemo(() => {
    const map = new Map<string, GuardianCalendarDay>();
    for (const day of calendarData?.days || []) {
      map.set(day.day_date, day);
    }
    return map;
  }, [calendarData]);

  const calendarDays: CalendarDay[] = useMemo(() => {
    return monthGrid.map((cell) => {
      const dayData = dayDataMap.get(cell.dateKey);
      const plannedMin = dayData?.planned_minutes ?? 0;
      const completedMin = dayData?.completed_minutes ?? 0;
      const rawStatus = (dayData?.status ?? "planned") as DayStatus;
      const pct = plannedMin > 0 ? Math.min(100, Math.round((completedMin / plannedMin) * 100)) : 0;
      return {
        ...cell,
        plannedMin,
        completedMin,
        status: rawStatus,
        pct,
        attemptCount: dayData?.attempt_count ?? 0,
        accuracy: dayData?.accuracy ?? null,
      };
    });
  }, [monthGrid, dayDataMap]);

  const todayKey = formatDateKey(new Date());

  const goToPrevMonth = () => {
    setCurrentMonth(new Date(year, month - 1, 1));
    setSelectedDateKey(null);
  };

  const goToNextMonth = () => {
    setCurrentMonth(new Date(year, month + 1, 1));
    setSelectedDateKey(null);
  };

  const selectedDay = selectedDateKey ? calendarDays.find((d) => d.dateKey === selectedDateKey) : null;

  const studentName = studentData?.student?.displayName || 'Student';
  const streak = calendarData?.streak ?? { current: 0, longest: 0 };

  if (!studentId) {
    return (
      <div className="min-h-screen bg-[#FFFAEF] flex items-center justify-center">
        <p className="text-[#0F2E48]">No student selected</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFAEF] p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/guardian">
            <Button variant="ghost" size="sm" className="text-[#0F2E48]">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
        </div>

        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-[#0F2E48]">{studentName}'s Calendar</h1>
            <p className="text-[#0F2E48]/60 text-sm">Read-only view of study progress</p>
          </div>
          {streak.current > 0 && (
            <div className="flex items-center gap-2 bg-orange-100 px-3 py-2 rounded-lg">
              <Flame className="h-5 w-5 text-orange-500" />
              <span className="font-semibold text-orange-700">{streak.current} day streak</span>
            </div>
          )}
        </div>

        <Card className="bg-white border-[#0F2E48]/10">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={goToPrevMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <CardTitle className="text-[#0F2E48]">
                {currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={goToNextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-[#0F2E48]/50" />
              </div>
            ) : error ? (
              <div className="text-center py-12">
                <p className="text-red-600 mb-4">Failed to load calendar</p>
                <Button variant="outline" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            ) : !calendarData?.days || calendarData.days.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-[#0F2E48]/60 mb-2">No calendar data available</p>
                <p className="text-sm text-[#0F2E48]/40">The student hasn't created a study plan yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="text-center text-xs font-medium text-[#0F2E48]/60 py-2">
                    {day}
                  </div>
                ))}
                {calendarDays.map((day) => {
                  const isToday = day.dateKey === todayKey;
                  const isSelected = day.dateKey === selectedDateKey;
                  const hasData = day.plannedMin > 0;
                  const badge = getStatusBadge(day.status, day.completedMin, day.plannedMin);

                  return (
                    <button
                      key={day.dateKey}
                      onClick={() => setSelectedDateKey(day.dateKey)}
                      disabled={!day.isCurrentMonth}
                      className={`
                        relative p-2 min-h-[72px] rounded-lg text-left transition-all
                        ${day.isCurrentMonth ? 'bg-[#FFFAEF] hover:bg-[#0F2E48]/5' : 'bg-gray-50 opacity-40'}
                        ${isSelected ? 'ring-2 ring-[#0F2E48]' : ''}
                        ${isToday ? 'border-2 border-[#0F2E48]' : 'border border-[#0F2E48]/10'}
                      `}
                    >
                      <span className={`text-sm font-medium ${isToday ? 'text-[#0F2E48] font-bold' : 'text-[#0F2E48]/80'}`}>
                        {day.day}
                      </span>
                      {hasData && day.isCurrentMonth && (
                        <div className="mt-1">
                          <div className={`text-[10px] px-1 py-0.5 rounded ${badge.className}`}>
                            {badge.label}
                          </div>
                          <div className="text-[10px] text-[#0F2E48]/60 mt-0.5">
                            {day.completedMin}/{day.plannedMin}m
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {selectedDay && selectedDay.isCurrentMonth && (
          <Card className="bg-white border-[#0F2E48]/10">
            <CardHeader>
              <CardTitle className="text-[#0F2E48]">
                {new Date(selectedDay.dateKey + 'T12:00:00').toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[#FFFAEF] p-4 rounded-lg text-center">
                  <div className="text-2xl font-bold text-[#0F2E48]">
                    {selectedDay.completedMin}
                  </div>
                  <div className="text-xs text-[#0F2E48]/60">Minutes Completed</div>
                </div>
                <div className="bg-[#FFFAEF] p-4 rounded-lg text-center">
                  <div className="text-2xl font-bold text-[#0F2E48]">
                    {selectedDay.plannedMin}
                  </div>
                  <div className="text-xs text-[#0F2E48]/60">Minutes Planned</div>
                </div>
                <div className="bg-[#FFFAEF] p-4 rounded-lg text-center">
                  <div className="text-2xl font-bold text-[#0F2E48]">
                    {selectedDay.attemptCount}
                  </div>
                  <div className="text-xs text-[#0F2E48]/60">Questions Attempted</div>
                </div>
                <div className="bg-[#FFFAEF] p-4 rounded-lg text-center">
                  <div className="text-2xl font-bold text-[#0F2E48]">
                    {selectedDay.accuracy !== null ? `${selectedDay.accuracy}%` : '--'}
                  </div>
                  <div className="text-xs text-[#0F2E48]/60">Accuracy</div>
                </div>
              </div>
              <div className="mt-4">
                <div className={`inline-block px-3 py-1 rounded-full text-sm ${getStatusBadge(selectedDay.status, selectedDay.completedMin, selectedDay.plannedMin).className}`}>
                  {getStatusBadge(selectedDay.status, selectedDay.completedMin, selectedDay.plannedMin).label}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="text-center text-sm text-[#0F2E48]/50 mt-8">
          This is a read-only view. Students manage their own calendar.
        </div>
      </div>
    </div>
  );
}
