import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { NexusPaths } from "./paths.js";

export interface TaskRecord {
  id: number;
  title: string;
  context: string;
  approach?: string;
  acceptance?: string;
  risk?: string;
  status: "pending" | "in_progress" | "completed";
  deps: number[];
  plan_issue?: number;
  owner?: string;
  owner_agent_id?: string;
  owner_reuse_policy?: "fresh" | "resume_if_same_artifact" | "resume";
  created_at?: string;
}

export interface TasksFile {
  goal: string;
  decisions: string[];
  tasks: TaskRecord[];
}

export interface TasksSummary {
  exists: boolean;
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  allCompleted: boolean;
}

export async function readTasks(paths: NexusPaths): Promise<TasksFile | null> {
  if (!existsSync(paths.TASKS_FILE)) return null;
  const raw = await readFile(paths.TASKS_FILE, "utf8");
  return JSON.parse(raw) as TasksFile;
}

export async function readTasksSummary(paths: NexusPaths): Promise<TasksSummary> {
  const data = await readTasks(paths);
  if (!data) {
    return {
      exists: false,
      total: 0,
      pending: 0,
      in_progress: 0,
      completed: 0,
      allCompleted: false
    };
  }

  const summary = {
    exists: true,
    total: data.tasks.length,
    pending: data.tasks.filter((task) => task.status === "pending").length,
    in_progress: data.tasks.filter((task) => task.status === "in_progress").length,
    completed: data.tasks.filter((task) => task.status === "completed").length,
    allCompleted: false
  };

  summary.allCompleted = summary.total > 0 && summary.completed === summary.total;
  return summary;
}
