/* A short demo quiz so the app can be tried (and the connection tested) straight away. */
(function () {
  'use strict';
  var saturn = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240">' +
    '<rect width="400" height="240" fill="#0b1030"/>' +
    '<g fill="#fff" opacity=".8"><circle cx="40" cy="30" r="1.5"/><circle cx="350" cy="50" r="1.2"/><circle cx="300" cy="200" r="1.5"/>' +
    '<circle cx="80" cy="190" r="1"/><circle cx="200" cy="20" r="1.2"/><circle cx="370" cy="150" r="1"/></g>' +
    '<ellipse cx="200" cy="125" rx="150" ry="32" fill="none" stroke="#d9c38c" stroke-width="10" opacity=".9"/>' +
    '<circle cx="200" cy="120" r="70" fill="#e3b866"/>' +
    '<path d="M134 105 h132 M131 125 h138 M138 145 h124" stroke="#c99a4a" stroke-width="8"/>' +
    '<path d="M50 125 a150 32 0 0 0 300 0" fill="none" stroke="#d9c38c" stroke-width="10"/>' +
    '</svg>');

  window.TQ = window.TQ || {};
  window.TQ.SAMPLE_QUIZ = {
    title: 'Sample quiz (try me first)',
    questions: [
      { type: 'quiz', question: 'Which planet is this?', answers: ['Jupiter', 'Saturn', 'Neptune', 'Uranus'], correct: 'B', time: 20, image: saturn },
      { type: 'truefalse', question: 'Octopuses have three hearts.', correct: true, time: 10 },
      { type: 'quiz', question: 'What is the capital city of Australia?', answers: ['Sydney', 'Melbourne', 'Canberra', 'Perth'], correct: 'C', time: 20 },
      { type: 'quiz', question: 'How many minutes are in a full week?', answers: ['10,080', '8,640', '12,400', '9,960'], correct: 'A', time: 30, points: 'double' },
      { type: 'truefalse', question: 'The Great Wall of China is easily visible from the Moon with the naked eye.', correct: false, time: 10 }
    ]
  };
})();
