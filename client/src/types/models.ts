export interface User {
  id: number;
  email: string;
  name: string;
}

export interface Child {
  id: number;
  first_name: string;
  last_name: string;
  birth_date: string;
  picture_url: string | null;
  picture_content_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface Feeding {
  id: number;
  child_id: number;
  type: "breast_left" | "breast_right" | "both_breasts" | "bottle" | "solid" | "fortified_breast_milk";
  start_time: string;
  end_time: string | null;
  amount: number | null;
  amount_unit: "ml" | "oz" | "g" | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiaperChange {
  id: number;
  child_id: number;
  time: string;
  type: "wet" | "solid" | "both";
  color: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SleepEntry {
  id: number;
  child_id: number;
  start_time: string;
  end_time: string | null;
  is_nap: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TummyTime {
  id: number;
  child_id: number;
  start_time: string;
  end_time: string | null;
  milestone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Pumping {
  id: number;
  child_id: number;
  start_time: string;
  end_time: string | null;
  amount: number | null;
  amount_unit: "ml" | "oz" | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Growth {
  id: number;
  child_id: number;
  date: string;
  weight: number | null;
  weight_unit: string | null;
  height: number | null;
  height_unit: string | null;
  head_circumference: number | null;
  head_circumference_unit: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Temperature {
  id: number;
  child_id: number;
  time: string;
  reading: number;
  reading_unit: "F" | "C";
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: number;
  child_id: number;
  time: string;
  title: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface Timer {
  id: number;
  child_id: number;
  user_id: number;
  name: string;
  start_time: string;
  end_time: string | null;
  is_active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
