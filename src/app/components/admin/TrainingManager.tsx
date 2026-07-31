import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GraduationCap, Plus, Search, Edit, Trash2, CheckCircle, Clock, Loader2,
  Save, X, BookOpen, Award, Users, Play, FileText, HelpCircle, Archive,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthContext";
import { Modal, modalButtonClass } from "../common/Modal";
import { btnClass, LoadingState, ErrorState, EmptyState } from "../common/AdminUI";

type Course = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  difficulty: string | null;
  estimated_hours: number | null;
  thumbnail_url: string | null;
  is_published: boolean;
  approval_status: string;
  created_at: string;
};

type CourseModule = {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  module_order: number;
};

type Lesson = {
  id: string;
  module_id: string;
  title: string;
  content: string | null;
  video_url: string | null;
  pdf_url: string | null;
  duration_minutes: number;
  lesson_order: number;
};

type Enrollment = {
  id: string;
  user_id: string;
  course_id: string;
  status: string;
  progress_pct: number;
  score: number | null;
  enrolled_at: string;
  completed_at: string | null;
};

type CourseFormData = {
  title: string;
  description: string;
  category: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  estimated_hours: string;
  is_published: boolean;
};

const EMPTY_FORM: CourseFormData = {
  title: "",
  description: "",
  category: "General",
  difficulty: "beginner",
  estimated_hours: "2",
  is_published: false,
};

type Tab = "courses" | "modules" | "enrollments";

export function TrainingManager() {
  const { currentUser } = useAuth();
  const [tab, setTab] = useState<Tab>("courses");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [courses, setCourses] = useState<Course[]>([]);
  const [modules, setModules] = useState<CourseModule[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [query, setQuery] = useState("");

  // Course modal
  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [form, setForm] = useState<CourseFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Detail view
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [courseModules, setCourseModules] = useState<CourseModule[]>([]);
  const [courseLessons, setCourseLessons] = useState<Record<string, Lesson[]>>({});
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    try {
      const [c, m, e] = await Promise.all([
        supabase.from("training_courses").select("*").order("created_at", { ascending: false }).limit(100),
        supabase.from("training_modules").select("*").order("module_order", { ascending: true }).limit(200),
        supabase.from("training_enrollments").select("*").order("enrolled_at", { ascending: false }).limit(100),
      ]);
      if (c.error) throw c.error;
      setCourses((c.data ?? []) as Course[]);
      if (!m.error) setModules((m.data ?? []) as CourseModule[]);
      if (!e.error) setEnrollments((e.data ?? []) as Enrollment[]);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Failed to load training data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredCourses = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c) =>
      [c.title, c.description ?? "", c.category ?? "", c.difficulty ?? ""]
        .join(" ").toLowerCase().includes(q),
    );
  }, [courses, query]);

  const openCreate = () => {
    setEditingCourseId(null);
    setForm(EMPTY_FORM);
    setCourseModalOpen(true);
  };

  const openEdit = (c: Course) => {
    setEditingCourseId(c.id);
    setForm({
      title: c.title,
      description: c.description ?? "",
      category: c.category ?? "General",
      difficulty: (c.difficulty as "beginner" | "intermediate" | "advanced") ?? "beginner",
      estimated_hours: String(c.estimated_hours ?? "2"),
      is_published: c.is_published,
    });
    setCourseModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !supabase || !currentUser?.id) {
      setError("Title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        category: form.category.trim(),
        difficulty: form.difficulty,
        estimated_hours: parseFloat(form.estimated_hours) || null,
        is_published: form.is_published,
        approval_status: "approved",
        created_by: currentUser.id,
      };
      if (editingCourseId) {
        const { error: err } = await supabase.from("training_courses").update(payload).eq("id", editingCourseId);
        if (err) throw err;
        setSuccess("Course updated.");
      } else {
        const { error: err } = await supabase.from("training_courses").insert(payload);
        if (err) throw err;
        setSuccess("Course created.");
      }
      setCourseModalOpen(false);
      setTimeout(() => setSuccess(null), 3000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save course");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: Course) => {
    if (!supabase) return;
    if (!window.confirm(`Delete "${c.title}"? This also deletes all modules and lessons.`)) return;
    try {
      const { error: err } = await supabase.from("training_courses").delete().eq("id", c.id);
      if (err) throw err;
      setSuccess("Course deleted.");
      setTimeout(() => setSuccess(null), 3000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const handleTogglePublish = async (c: Course) => {
    if (!supabase) return;
    try {
      await supabase.from("training_courses").update({ is_published: !c.is_published }).eq("id", c.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle");
    }
  };

  const openDetail = async (c: Course) => {
    setSelectedCourse(c);
    setCourseModules([]);
    setCourseLessons({});
    setDetailLoading(true);
    if (!supabase) { setDetailLoading(false); return; }
    try {
      const { data: mods } = await supabase
        .from("training_modules")
        .select("*")
        .eq("course_id", c.id)
        .order("module_order", { ascending: true });
      const modList = (mods ?? []) as CourseModule[];
      setCourseModules(modList);
      // Load lessons for each module
      const lessonsMap: Record<string, Lesson[]> = {};
      for (const m of modList) {
        const { data: lessons } = await supabase
          .from("training_lessons")
          .select("*")
          .eq("module_id", m.id)
          .order("lesson_order", { ascending: true });
        lessonsMap[m.id] = (lessons ?? []) as Lesson[];
      }
      setCourseLessons(lessonsMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load course detail");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleAddModule = async () => {
    if (!selectedCourse || !supabase) return;
    const title = window.prompt("Module title", "New Module");
    if (!title) return;
    try {
      await supabase.from("training_modules").insert({
        course_id: selectedCourse.id,
        title,
        description: "",
        module_order: courseModules.length,
      });
      await openDetail(selectedCourse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add module");
    }
  };

  const handleAddLesson = async (moduleId: string) => {
    if (!supabase) return;
    const title = window.prompt("Lesson title", "New Lesson");
    if (!title) return;
    const existing = courseLessons[moduleId] ?? [];
    try {
      await supabase.from("training_lessons").insert({
        module_id: moduleId,
        title,
        content: "",
        duration_minutes: 10,
        lesson_order: existing.length,
      });
      if (selectedCourse) await openDetail(selectedCourse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add lesson");
    }
  };

  const tabs: { value: Tab; label: string; icon: typeof BookOpen; count?: number }[] = [
    { value: "courses", label: "Courses", icon: BookOpen, count: courses.length },
    { value: "modules", label: "Modules", icon: GraduationCap, count: modules.length },
    { value: "enrollments", label: "Enrollments", icon: Users, count: enrollments.length },
  ];

  const stats = {
    total: courses.length,
    published: courses.filter((c) => c.is_published).length,
    enrollments: enrollments.length,
    completed: enrollments.filter((e) => e.status === "completed").length,
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 bg-background min-h-full">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
              <GraduationCap className="w-5 h-5" /> Training Manager
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage courses, modules, lessons, enrollments, and certificates.
            </p>
          </div>
          <button className={btnClass.primary} type="button" onClick={openCreate}>
            <Plus className="w-4 h-4" /> Add Course
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Total Courses</span>
            </div>
            <p className="text-2xl font-semibold">{stats.total}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Published</span>
            </div>
            <p className="text-2xl font-semibold">{stats.published}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Enrollments</span>
            </div>
            <p className="text-2xl font-semibold">{stats.enrollments}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Award className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Completed</span>
            </div>
            <p className="text-2xl font-semibold">{stats.completed}</p>
          </div>
        </div>

        {error ? <ErrorState message={error} /> : null}
        {success ? (
          <div className="bg-primary/5 border border-primary/30 rounded-xl p-3 text-sm text-primary">{success}</div>
        ) : null}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors whitespace-nowrap ${
                tab === t.value ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="w-4 h-4" /> {t.label}
              {t.count != null ? <span className="text-[10px] bg-accent px-1.5 py-0.5 rounded-full">{t.count}</span> : null}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/40 text-sm"
            placeholder={tab === "courses" ? "Search courses…" : tab === "modules" ? "Search modules…" : "Search enrollments…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {loading ? <LoadingState label="Loading training data…" /> : null}

        {/* Courses tab */}
        {tab === "courses" && !loading ? (
          filteredCourses.length === 0 ? (
            <div className="bg-card border border-border rounded-2xl">
              <EmptyState title="No courses yet" description="Create your first training course." icon={<BookOpen className="w-5 h-5" />} />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredCourses.map((c) => {
                const diffColor = c.difficulty === "beginner" ? "bg-green-100 text-green-700"
                  : c.difficulty === "intermediate" ? "bg-amber-100 text-amber-700"
                  : "bg-rose-100 text-rose-700";
                return (
                  <div key={c.id} className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-xl bg-accent flex items-center justify-center shrink-0">
                          <BookOpen className="w-5 h-5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold truncate">{c.title}</h3>
                          {c.category ? <p className="text-xs text-muted-foreground mt-0.5">{c.category}</p> : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {c.is_published ? <CheckCircle className="w-3.5 h-3.5 text-primary" /> : <Clock className="w-3.5 h-3.5 text-muted-foreground" />}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${c.is_published ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                          {c.is_published ? "Published" : "Draft"}
                        </span>
                      </div>
                    </div>
                    {c.description ? <p className="text-xs text-muted-foreground line-clamp-2">{c.description}</p> : null}
                    <div className="flex items-center gap-2 flex-wrap">
                      {c.difficulty ? <span className={`text-[10px] px-2 py-0.5 rounded-full ${diffColor}`}>{c.difficulty}</span> : null}
                      {c.estimated_hours ? <span className="text-[10px] text-muted-foreground">⏱ {c.estimated_hours}h</span> : null}
                      <span className="text-[10px] text-muted-foreground ml-auto">{new Date(c.created_at).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-1 pt-2 border-t border-border">
                      <button type="button" className="text-xs px-2 py-1 rounded border border-border hover:bg-accent" onClick={() => openDetail(c)}>View modules</button>
                      <button type="button" className="text-xs px-2 py-1 rounded border border-border hover:bg-accent" onClick={() => openEdit(c)} aria-label="Edit">
                        <Edit className="w-3 h-3" />
                      </button>
                      <button type="button" className="text-xs px-2 py-1 rounded border border-border hover:bg-accent" onClick={() => handleTogglePublish(c)}>
                        {c.is_published ? "Unpublish" : "Publish"}
                      </button>
                      <button type="button" className="text-xs px-2 py-1 rounded border border-destructive/30 text-destructive hover:bg-destructive/10 ml-auto" onClick={() => handleDelete(c)} aria-label="Delete">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : null}

        {/* Modules tab */}
        {tab === "modules" && !loading ? (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-accent/50 border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Module</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground hidden sm:table-cell">Course</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {modules.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">No modules yet.</td></tr>
                ) : (
                  modules.map((m) => {
                    const course = courses.find((c) => c.id === m.course_id);
                    return (
                      <tr key={m.id} className="hover:bg-accent/30">
                        <td className="px-4 py-2 font-medium">{m.title}</td>
                        <td className="px-4 py-2 hidden sm:table-cell text-muted-foreground">{course?.title ?? "—"}</td>
                        <td className="px-4 py-2 text-muted-foreground">#{m.module_order}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        {/* Enrollments tab */}
        {tab === "enrollments" && !loading ? (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-accent/50 border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground hidden sm:table-cell">Course</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Progress</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground hidden sm:table-cell">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {enrollments.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No enrollments yet.</td></tr>
                ) : (
                  enrollments.map((e) => {
                    const course = courses.find((c) => c.id === e.course_id);
                    const statusColor = e.status === "completed" ? "bg-green-100 text-green-700"
                      : e.status === "in_progress" ? "bg-amber-100 text-amber-700"
                      : "bg-muted text-muted-foreground";
                    return (
                      <tr key={e.id} className="hover:bg-accent/30">
                        <td className="px-4 py-2 font-mono text-xs">{e.user_id.slice(0, 8)}…</td>
                        <td className="px-4 py-2 hidden sm:table-cell text-muted-foreground">{course?.title ?? "—"}</td>
                        <td className="px-4 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full ${statusColor}`}>{e.status}</span></td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-accent rounded-full overflow-hidden">
                              <div className="h-full bg-primary" style={{ width: `${e.progress_pct}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground">{Math.round(e.progress_pct)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2 hidden sm:table-cell text-muted-foreground">{e.score != null ? `${e.score}%` : "—"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {/* Course create/edit modal */}
      <Modal
        open={courseModalOpen}
        onClose={() => setCourseModalOpen(false)}
        title={editingCourseId ? "Edit Course" : "Add Course"}
        size="md"
        footer={
          <>
            <button type="button" className={modalButtonClass.secondary} onClick={() => setCourseModalOpen(false)}>
              <X className="w-4 h-4" /> Cancel
            </button>
            <button type="button" className={modalButtonClass.primary} onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingCourseId ? "Save" : "Create"}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Course Title *</label>
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
              <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Difficulty</label>
              <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as "beginner" | "intermediate" | "advanced" })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm">
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Estimated Hours</label>
              <input type="number" step="0.5" value={form.estimated_hours} onChange={(e) => setForm({ ...form, estimated_hours: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm pb-2">
                <input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} className="rounded" />
                Publish immediately
              </label>
            </div>
          </div>
        </div>
      </Modal>

      {/* Course detail modal (modules + lessons) */}
      <Modal
        open={!!selectedCourse}
        onClose={() => setSelectedCourse(null)}
        title={selectedCourse?.title ?? "Course"}
        description="Modules and lessons in this course"
        size="lg"
        footer={
          <button type="button" className={modalButtonClass.primary} onClick={handleAddModule}>
            <Plus className="w-4 h-4" /> Add Module
          </button>
        }
      >
        {detailLoading ? (
          <LoadingState label="Loading modules…" />
        ) : courseModules.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No modules yet. Click "Add Module" to create one.</p>
        ) : (
          <div className="space-y-3">
            {courseModules.map((m, mi) => (
              <div key={m.id} className="border border-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono bg-accent px-1.5 py-0.5 rounded">M{mi + 1}</span>
                    <span className="text-sm font-medium">{m.title}</span>
                  </div>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => handleAddLesson(m.id)}>
                    + Lesson
                  </button>
                </div>
                {m.description ? <p className="text-xs text-muted-foreground mb-2">{m.description}</p> : null}
                {(courseLessons[m.id] ?? []).length > 0 ? (
                  <ul className="space-y-1">
                    {(courseLessons[m.id] ?? []).map((l, li) => (
                      <li key={l.id} className="flex items-center gap-2 text-xs px-2 py-1.5 bg-accent/30 rounded">
                        {l.video_url ? <Play className="w-3 h-3 text-primary" /> : l.pdf_url ? <FileText className="w-3 h-3 text-primary" /> : <FileText className="w-3 h-3 text-muted-foreground" />}
                        <span className="font-mono text-[10px] text-muted-foreground">{mi + 1}.{li + 1}</span>
                        <span className="flex-1 truncate">{l.title}</span>
                        <span className="text-[10px] text-muted-foreground">{l.duration_minutes}m</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[10px] text-muted-foreground italic px-2">No lessons yet.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
