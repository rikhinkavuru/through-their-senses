/**
 * Verbatim quotes from people living with glaucoma, from:
 * Glen FC, Crabb DP. Living with glaucoma: a qualitative study of functional
 * implications and patients' coping behaviours. BMC Ophthalmology 2015;15:128.
 * doi:10.1186/s12886-015-0119-7. Open access, CC BY 4.0. Participant codes are the
 * paper's own (F = female, M = male). Ellipses and brackets are as published.
 */
export const QUOTE_SOURCE = {
  cite: "Glen and Crabb, BMC Ophthalmology 2015",
  url: "https://doi.org/10.1186/s12886-015-0119-7",
  license: "CC BY 4.0",
};

export type QuoteTopic = "scanning" | "steps" | "light" | "family" | "independence" | "faces" | "contrast" | "hearing" | "outlook";

export interface Quote {
  text: string;
  who: string;
  topics: QuoteTopic[];
}

export const QUOTES: Quote[] = [
  {
    text: "[When going] up and down stairs, I actually turn my head up and down, because I’m not - I suppose I’m conscious now that I can’t see up here.",
    who: "F6",
    topics: ["scanning", "steps"],
  },
  {
    text: "I do notice that I’ve consciously got to move my head to the right and left more. I’m saying more than I did before, because I’ve got to be extra careful.",
    who: "M7",
    topics: ["scanning"],
  },
  {
    text: "My wife or friends always say “there's a step down” and then that helps if I know there’s one there and I can gingerly take it, particularly if it’s a dark pub.",
    who: "M4",
    topics: ["steps", "family", "light"],
  },
  {
    text: "Do tell all your family and that you - what you find difficult? So that you do get some help from people saying, there’s a flight of steps here, there are two steps there…",
    who: "F4",
    topics: ["family", "steps"],
  },
  {
    text: "I’ve been given a folding stick so that I can hold it in front when I’m on my own - if I’ve got my husband or my son with me it’s different. I want to keep as independent as I can.",
    who: "F1",
    topics: ["independence", "family"],
  },
  {
    text: "The fact that you have got to be in the controlling seat… nobody’s going to do the job for you, you’ve got to do it.",
    who: "F4",
    topics: ["independence", "outlook"],
  },
  {
    text: "In dull light and things like this I found it quite hard to see. Now our house is filled with daylight bulbs which made a huge difference. So I can actually see what I’m doing.",
    who: "F4",
    topics: ["light"],
  },
  {
    text: "Well it’s going from light to dark, like entering a cinema, I’m absolutely blinded; I can’t see anything. I have to hold onto somebody or I shall fall over any steps and I shan’t find the seat.",
    who: "F7",
    topics: ["light", "steps"],
  },
  {
    text: "On a patterned surface I have great difficulty finding things. If I’m putting something down I make a conscious decision o put it against a contrasting background.",
    who: "F7",
    topics: ["contrast"],
  },
  {
    text: "Cutting brown bread on a brown cutting board, I don’t always get the thickness of the bread right. I have to look and doubly look and look at it from all angles, make sure I’m doing it okay.",
    who: "M4",
    topics: ["contrast"],
  },
  {
    text: "I’m not very good on identifying people’s faces. That’s got worse over the years, particularly on TV as well.",
    who: "M4",
    topics: ["faces"],
  },
  {
    text: "These days of terrible uneven pavements and great holes, it’s quite a dangerous thing. So I have to walk with my head down to see where I’m putting my feet.",
    who: "F4",
    topics: ["steps", "scanning"],
  },
  {
    text: "I think most people are very helpful on the eyesight side. They’re not so helpful on the hearing side. They’re not so understanding.",
    who: "F4",
    topics: ["hearing", "family"],
  },
  {
    text: "Going right back to the start [when I was first diagnosed], I think it would have been a great help if I could have talked to someone who’d had the same situation.",
    who: "M6",
    topics: ["outlook"],
  },
  {
    text: "I think mainly I just try not to let it stop me doing anything.",
    who: "F5",
    topics: ["outlook", "independence"],
  },
];

export function quoteFor(topic: QuoteTopic, offset = 0): Quote {
  const list = QUOTES.filter((q) => q.topics.includes(topic));
  return list[offset % list.length] ?? QUOTES[0];
}
