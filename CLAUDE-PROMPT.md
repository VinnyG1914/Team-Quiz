# Prompt for Claude

Copy everything in the box into Claude, replace `[TOPIC]` and `[NUMBER]`, then use **📋 Paste from Claude** on the host page. The same text is behind the **🤖 Copy prompt for Claude** button.

```
Create a fun team quiz about: [TOPIC]. Make [NUMBER] questions.

Reply with ONLY a JSON code block in exactly this format, nothing else:

{
  "title": "Quiz title",
  "questions": [
    { "type": "quiz", "question": "Which planet is known as the Red Planet?",
      "answers": ["Venus", "Mars", "Jupiter", "Saturn"], "correct": "B", "time": 20 },
    { "type": "truefalse", "question": "Octopuses have three hearts.", "correct": true, "time": 10 }
  ]
}

Rules:
- "type" is "quiz" (2 to 4 answers) or "truefalse".
- For "quiz", "correct" is the letter of the right answer: "A", "B", "C" or "D" (first answer is A). Use a list like ["A","C"] only if more than one answer is right.
- For "truefalse", "correct" is true or false, and there is no "answers" list.
- Keep questions under 120 characters and answers under 60 characters.
- "time" is seconds to answer: 10 for easy, 20 for normal, 30 for harder questions.
- Optional: add "points": "double" to one or two of the hardest questions.
- Add a top-level "theme" that suits the topic, one of: galaxy, night-sky, summit, beach, highlands, lake, mountain-lake, city, party, arcade, rotate.
- Mix the position of the correct answer and keep it suitable for work.
```

Add images afterwards in the editor (paste, drop or pick a file per question).
