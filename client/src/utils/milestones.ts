// Developmental milestones for the dashboard: what most children can do by
// each checkpoint age, and which checkpoint a child is heading toward today.
//
// The list is fixed reference data, not something generated. Every item is
// adapted from the CDC's "Learn the Signs. Act Early." checklists, which the
// CDC revised with the American Academy of Pediatrics in 2022 (Zubler et al.,
// Pediatrics). Each checkpoint links to its own CDC page, so every line on
// screen can be traced back to that page. A model would write the same kind
// of sentence and then invent a source for it, which on a page about a baby's
// development is worse than having no page. The server's AI jobs follow the
// same rule: figures come from data, and the model only writes prose around
// them. Here nothing needs rewording, so no model is involved.
//
// The wording follows the CDC pages closely. The only change is pronouns: the
// CDC checklists alternate "he" and "she" between ages, and this app does not
// know the child's pronouns, so every item uses "they".
//
// Everything here is pure and date-injectable, like childMoments.ts.

import { parseBirthDate } from "./childMoments";

export type MilestoneDomain = "social" | "language" | "cognitive" | "movement";

export const MILESTONE_DOMAINS: MilestoneDomain[] = ["social", "language", "cognitive", "movement"];

/** The CDC's own section headings, in the order its pages list them. */
export const MILESTONE_DOMAIN_LABELS: Record<MilestoneDomain, string> = {
  social: "Social / emotional",
  language: "Language / communication",
  cognitive: "Cognitive (learning, problem-solving)",
  movement: "Movement / physical",
};

export interface MilestoneCheckpoint {
  /** Age in whole months. The CDC checkpoints are "by N months". */
  months: number;
  /** How the CDC names the checkpoint: "2 months", "1 year", "30 months". */
  label: string;
  /** The CDC page this checkpoint's items were taken from. */
  sourceUrl: string;
  items: Record<MilestoneDomain, string[]>;
}

/** Citation shown with every checkpoint. */
export const MILESTONE_SOURCE = {
  program: "Learn the Signs. Act Early.",
  paper:
    "Zubler JM, Wiggins LD, Macias MM, et al. Evidence-Informed Milestones for Developmental " +
    "Surveillance Tools. Pediatrics. 2022;149(3):e2021052138.",
  paperUrl: "https://doi.org/10.1542/peds.2021-052138",
} as const;

const cdc = (slug: string) => `https://www.cdc.gov/act-early/milestones/${slug}.html`;

export const DEVELOPMENTAL_MILESTONES: MilestoneCheckpoint[] = [
  {
    months: 2,
    label: "2 months",
    sourceUrl: cdc("2-months"),
    items: {
      social: [
        "Calms down when spoken to or picked up",
        "Looks at your face",
        "Seems happy to see you when you walk up to them",
        "Smiles when you talk to or smile at them",
      ],
      language: ["Makes sounds other than crying", "Reacts to loud sounds"],
      cognitive: ["Watches you as you move", "Looks at a toy for several seconds"],
      movement: ["Holds head up when on tummy", "Moves both arms and both legs", "Opens hands briefly"],
    },
  },
  {
    months: 4,
    label: "4 months",
    sourceUrl: cdc("4-months"),
    items: {
      social: [
        "Smiles on their own to get your attention",
        "Chuckles (not yet a full laugh) when you try to make them laugh",
        "Looks at you, moves, or makes sounds to get or keep your attention",
      ],
      language: [
        "Makes sounds like “oooo” and “aahh” (cooing)",
        "Makes sounds back when you talk to them",
        "Turns head toward the sound of your voice",
      ],
      cognitive: [
        "If hungry, opens mouth when they see breast or bottle",
        "Looks at their hands with interest",
      ],
      movement: [
        "Holds head steady without support when you are holding them",
        "Holds a toy when you put it in their hand",
        "Uses their arm to swing at toys",
        "Brings hands to mouth",
        "Pushes up onto elbows/forearms when on tummy",
      ],
    },
  },
  {
    months: 6,
    label: "6 months",
    sourceUrl: cdc("6-months"),
    items: {
      social: ["Knows familiar people", "Likes to look at themself in a mirror", "Laughs"],
      language: [
        "Takes turns making sounds with you",
        "Blows “raspberries” (sticks tongue out and blows)",
        "Makes squealing noises",
      ],
      cognitive: [
        "Puts things in their mouth to explore them",
        "Reaches to grab a toy they want",
        "Closes lips to show they don’t want more food",
      ],
      movement: [
        "Rolls from tummy to back",
        "Pushes up with straight arms when on tummy",
        "Leans on hands to support themself when sitting",
      ],
    },
  },
  {
    months: 9,
    label: "9 months",
    sourceUrl: cdc("9-months"),
    items: {
      social: [
        "Is shy, clingy, or fearful around strangers",
        "Shows several facial expressions, like happy, sad, angry, and surprised",
        "Looks when you call their name",
        "Reacts when you leave (looks, reaches for you, or cries)",
        "Smiles or laughs when you play peek-a-boo",
      ],
      language: ["Makes different sounds like “mamamama” and “babababa”", "Lifts arms up to be picked up"],
      cognitive: [
        "Looks for objects when dropped out of sight (like their spoon or toy)",
        "Bangs two things together",
      ],
      movement: [
        "Gets to a sitting position by themself",
        "Moves things from one hand to the other",
        "Uses fingers to “rake” food toward themself",
        "Sits without support",
      ],
    },
  },
  {
    months: 12,
    label: "1 year",
    sourceUrl: cdc("1-year"),
    items: {
      social: ["Plays games with you, like pat-a-cake"],
      language: [
        "Waves “bye-bye”",
        "Calls a parent “mama” or “dada” or another special name",
        "Understands “no” (pauses briefly or stops when you say it)",
      ],
      cognitive: [
        "Puts something in a container, like a block in a cup",
        "Looks for things they see you hide, like a toy under a blanket",
      ],
      movement: [
        "Pulls up to stand",
        "Walks, holding on to furniture",
        "Drinks from a cup without a lid, as you hold it",
        "Picks things up between thumb and pointer finger, like small bits of food",
      ],
    },
  },
  {
    months: 15,
    label: "15 months",
    sourceUrl: cdc("15-months"),
    items: {
      social: [
        "Copies other children while playing, like taking toys out of a container when another child does",
        "Shows you an object they like",
        "Claps when excited",
        "Hugs a stuffed doll or other toy",
        "Shows you affection (hugs, cuddles, or kisses you)",
      ],
      language: [
        "Tries to say one or two words besides “mama” or “dada”, like “ba” for ball or “da” for dog",
        "Looks at a familiar object when you name it",
        "Follows directions given with both a gesture and words, like handing you a toy when you hold out your hand and ask for it",
        "Points to ask for something or to get help",
      ],
      cognitive: [
        "Tries to use things the right way, like a phone, cup, or book",
        "Stacks at least two small objects, like blocks",
      ],
      movement: ["Takes a few steps on their own", "Uses fingers to feed themself some food"],
    },
  },
  {
    months: 18,
    label: "18 months",
    sourceUrl: cdc("18-months"),
    items: {
      social: [
        "Moves away from you, but looks to make sure you are close by",
        "Points to show you something interesting",
        "Puts hands out for you to wash them",
        "Looks at a few pages in a book with you",
        "Helps you dress them by pushing an arm through a sleeve or lifting up a foot",
      ],
      language: [
        "Tries to say three or more words besides “mama” or “dada”",
        "Follows one-step directions without any gestures, like giving you the toy when you say “Give it to me”",
      ],
      cognitive: [
        "Copies you doing chores, like sweeping with a broom",
        "Plays with toys in a simple way, like pushing a toy car",
      ],
      movement: [
        "Walks without holding on to anyone or anything",
        "Scribbles",
        "Drinks from a cup without a lid and may spill sometimes",
        "Feeds themself with their fingers",
        "Tries to use a spoon",
        "Climbs on and off a couch or chair without help",
      ],
    },
  },
  {
    months: 24,
    label: "2 years",
    sourceUrl: cdc("2-years"),
    items: {
      social: [
        "Notices when others are hurt or upset, like pausing or looking sad when someone is crying",
        "Looks at your face to see how to react in a new situation",
      ],
      language: [
        "Points to things in a book when you ask, like “Where is the bear?”",
        "Says at least two words together, like “More milk”",
        "Points to at least two body parts when you ask them to show you",
        "Uses more gestures than just waving and pointing, like blowing a kiss or nodding yes",
      ],
      cognitive: [
        "Holds something in one hand while using the other, like holding a container and taking the lid off",
        "Tries to use switches, knobs, or buttons on a toy",
        "Plays with more than one toy at the same time, like putting toy food on a toy plate",
      ],
      movement: [
        "Kicks a ball",
        "Runs",
        "Walks (not climbs) up a few stairs with or without help",
        "Eats with a spoon",
      ],
    },
  },
  {
    months: 30,
    label: "30 months",
    sourceUrl: cdc("30-months"),
    items: {
      social: [
        "Plays next to other children and sometimes plays with them",
        "Shows you what they can do by saying “Look at me!”",
        "Follows simple routines when told, like helping to pick up toys when you say “It’s clean-up time”",
      ],
      language: [
        "Says about 50 words",
        "Says two or more words together, with one action word, like “Doggie run”",
        "Names things in a book when you point and ask “What is this?”",
        "Says words like “I”, “me”, or “we”",
      ],
      cognitive: [
        "Uses things to pretend, like feeding a block to a doll as if it were food",
        "Shows simple problem-solving skills, like standing on a small stool to reach something",
        "Follows two-step instructions like “Put the toy down and close the door”",
        "Shows they know at least one color, like pointing to a red crayon when you ask “Which one is red?”",
      ],
      movement: [
        "Uses hands to twist things, like turning doorknobs or unscrewing lids",
        "Takes some clothes off by themself, like loose pants or an open jacket",
        "Jumps off the ground with both feet",
        "Turns book pages, one at a time, when you read to them",
      ],
    },
  },
  {
    months: 36,
    label: "3 years",
    sourceUrl: cdc("3-years"),
    items: {
      social: [
        "Calms down within 10 minutes after you leave them, like at a childcare drop-off",
        "Notices other children and joins them to play",
      ],
      language: [
        "Talks with you in conversation using at least two back-and-forth exchanges",
        "Asks “who”, “what”, “where”, or “why” questions",
        "Says what action is happening in a picture or book when asked, like “running”, “eating”, or “playing”",
        "Says their first name when asked",
        "Talks well enough for others to understand, most of the time",
      ],
      cognitive: [
        "Draws a circle when you show them how",
        "Avoids touching hot objects, like a stove, when you warn them",
      ],
      movement: [
        "Strings items together, like large beads or macaroni",
        "Puts on some clothes by themself, like loose pants or a jacket",
        "Uses a fork",
      ],
    },
  },
  {
    months: 48,
    label: "4 years",
    sourceUrl: cdc("4-years"),
    items: {
      social: [
        "Pretends to be something else during play (teacher, superhero, dog)",
        "Asks to go play with children if none are around",
        "Comforts others who are hurt or sad, like hugging a crying friend",
        "Avoids danger, like not jumping from tall heights at the playground",
        "Likes to be a “helper”",
        "Changes behavior based on where they are (place of worship, library, playground)",
      ],
      language: [
        "Says sentences with four or more words",
        "Says some words from a song, story, or nursery rhyme",
        "Talks about at least one thing that happened during their day",
        "Answers simple questions like “What is a coat for?” or “What is a crayon for?”",
      ],
      cognitive: [
        "Names a few colors of items",
        "Tells what comes next in a well-known story",
        "Draws a person with three or more body parts",
      ],
      movement: [
        "Catches a large ball most of the time",
        "Serves themself food or pours water, with adult supervision",
        "Unbuttons some buttons",
        "Holds a crayon or pencil between fingers and thumb (not a fist)",
      ],
    },
  },
  {
    months: 60,
    label: "5 years",
    sourceUrl: cdc("5-years"),
    items: {
      social: [
        "Follows rules or takes turns when playing games with other children",
        "Sings, dances, or acts for you",
        "Does simple chores at home, like matching socks or clearing the table after eating",
      ],
      language: [
        "Tells a story they heard or made up with at least two events",
        "Answers simple questions about a book or story after you read or tell it to them",
        "Keeps a conversation going with more than three back-and-forth exchanges",
        "Uses or recognizes simple rhymes (bat-cat, ball-tall)",
      ],
      cognitive: [
        "Counts to 10",
        "Names some numbers between 1 and 5 when you point to them",
        "Uses words about time, like “yesterday”, “tomorrow”, “morning”, or “night”",
        "Pays attention for 5 to 10 minutes during activities like story time (screen time does not count)",
        "Writes some letters in their name",
        "Names some letters when you point to them",
      ],
      movement: ["Buttons some buttons", "Hops on one foot"],
    },
  },
];

/**
 * How long a checkpoint stays in focus after the child reaches it. The
 * well-child visit that uses a checklist often happens a week or two after
 * the birthday it is named for, so switching to the next checkpoint on the
 * day itself would hide the list the doctor is about to go through.
 */
export const RECENT_CHECKPOINT_GRACE_DAYS = 14;

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Whole calendar days from `from` to `to`. Rounded, so a DST hour is ignored. */
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/**
 * The day the child turns `months` months old. When the birth day of the
 * month doesn't exist in that month (a 31st birthday in a 30-day month), the
 * date falls back to the month's last day. That is the same day the hero
 * card's "N months old today" badge appears.
 */
export function checkpointDate(birth: Date, months: number): Date {
  const date = new Date(birth.getFullYear(), birth.getMonth() + months, 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(birth.getDate(), lastDay));
  return date;
}

/** Days from today until the child reaches `checkpoint`. Negative once passed. */
export function daysUntilCheckpoint(birthDate: string, checkpoint: MilestoneCheckpoint, now: Date): number | null {
  const birth = parseBirthDate(birthDate);
  if (!birth) return null;
  return daysBetween(startOfDay(now), checkpointDate(birth, checkpoint.months));
}

export interface CheckpointFocus {
  index: number;
  checkpoint: MilestoneCheckpoint;
  /** Days until the child reaches this checkpoint. Zero or negative (down to
   *  `-RECENT_CHECKPOINT_GRACE_DAYS`) means it was reached recently. */
  daysUntil: number;
}

/**
 * The checkpoint that fits this child today. That is the next one coming up,
 * or the one just reached if it was within the last two weeks. Returns null
 * when there is nothing to show: no parseable birth date, a birth date in the
 * future, or a child well past the last checkpoint at 5 years.
 */
export function focusCheckpoint(birthDate: string, now: Date): CheckpointFocus | null {
  const birth = parseBirthDate(birthDate);
  if (!birth) return null;
  const today = startOfDay(now);
  if (today < birth) return null;
  for (let index = 0; index < DEVELOPMENTAL_MILESTONES.length; index++) {
    const checkpoint = DEVELOPMENTAL_MILESTONES[index];
    const daysUntil = daysBetween(today, checkpointDate(birth, checkpoint.months));
    if (daysUntil >= -RECENT_CHECKPOINT_GRACE_DAYS) return { index, checkpoint, daysUntil };
  }
  return null;
}

/** Every item in a checkpoint, in the CDC's domain order. */
export function checkpointItems(checkpoint: MilestoneCheckpoint): string[] {
  return MILESTONE_DOMAINS.flatMap((domain) => checkpoint.items[domain]);
}

/**
 * One item to preview on the dashboard, changing once a day. A card that
 * never changes turns into wallpaper, so the preview rotates through the
 * checkpoint's items. It is deterministic, so both parents see the same item
 * on the same day and the card doesn't change between refreshes.
 */
export function milestoneOfTheDay(checkpoint: MilestoneCheckpoint, now: Date): string {
  const items = checkpointItems(checkpoint);
  const dayNumber = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  return items[dayNumber % items.length];
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "3 days", "5 weeks", "4 months", "2 years": a readable length for a gap of days. */
function spanLabel(days: number): string {
  if (days < 14) return plural(days, "day");
  if (days < 12 * 7) return plural(Math.round(days / 7), "week");
  const months = Math.round(days / 30.44);
  if (months < 24) return plural(months, "month");
  return plural(Math.round(days / 365.25), "year");
}

/** "in 5 weeks", "today", "3 weeks ago": where a checkpoint sits from today. */
export function describeGap(daysUntil: number): string {
  if (daysUntil === 0) return "today";
  if (daysUntil === 1) return "tomorrow";
  if (daysUntil > 0) return `in ${spanLabel(daysUntil)}`;
  if (daysUntil === -1) return "yesterday";
  return `${spanLabel(-daysUntil)} ago`;
}

/** The short form for the dashboard row: "in 5 wks", "in 3 days", "now". */
export function compactGap(daysUntil: number): string {
  if (daysUntil <= 0) return "now";
  if (daysUntil === 1) return "tomorrow";
  if (daysUntil < 14) return `in ${daysUntil} days`;
  if (daysUntil < 12 * 7) return `in ${Math.round(daysUntil / 7)} wks`;
  return `in ${Math.round(daysUntil / 30.44)} mo`;
}
