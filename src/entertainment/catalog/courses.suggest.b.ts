import type { CatalogCourse } from '../contract';

/** Suggested courses B: tech & security, psychology, mindset, communication, art. Playlist ids verified against YouTube search results (title, author, video count). */
export const COURSE_SUGGESTED_B: CatalogCourse[] = [
  // TECH & SECURITY
  { id: 'PL1y1iaEtjSYiiSGVlL1cHsXN_kvJOOhu-', kind: 'playlist', title: 'Stanford CS253 Web Security', by: 'Feross Aboukhadijeh', topic: 'tech', origin: 'suggest', count: 19, about: 'How the web is attacked and defended: XSS, CSRF, CORS, CSP and more.', verified: true },
  { id: 'PLUl4u3cNGP62K2DjQLRxDNRi0z2IRWnNh', kind: 'playlist', title: 'MIT 6.858 Computer Systems Security (Fall 2014)', by: 'MIT OpenCourseWare', topic: 'tech', origin: 'suggest', count: 22, about: 'Building secure systems: buffer overflows, privilege, OS and web security.', verified: true },
  { id: 'PLhQjrBD2T383q7Vn8QnTsVgSvyLpsqL_R', kind: 'playlist', title: 'CS50x Introduction to Computer Science (2025)', by: 'Harvard CS50', topic: 'tech', origin: 'suggest', count: 13, about: "Harvard's famous intro to computer science and programming.", verified: true },
  { id: 'PLhQjrBD2T383Cqo5I1oRrbC1EKRAKGKUE', kind: 'playlist', title: "CS50's Introduction to Cybersecurity", by: 'Harvard CS50', topic: 'tech', origin: 'suggest', count: 6, about: 'Plain-language cybersecurity: passwords, phishing, encryption, privacy.', verified: true },
  { id: 'PLUl4u3cNGP63EdVPNLG3ToM6LaEUuStEY', kind: 'playlist', title: 'MIT 6.006 Introduction to Algorithms (Spring 2020)', by: 'MIT OpenCourseWare', topic: 'tech', origin: 'suggest', count: 32, about: 'Core data structures and algorithms, taught the MIT way.', verified: true },
  { id: 'PLoROMvodv4rMiGQp3WXShtMGgzqpfVfbU', kind: 'playlist', title: 'Stanford CS229 Machine Learning (Autumn 2018)', by: 'Stanford Online', topic: 'tech', origin: 'suggest', count: 21, about: 'Andrew Ng on the math and methods behind machine learning.', verified: true },
  { id: 'PLUl4u3cNGP63gFHB6xb-kVBiQHYe_4hSi', kind: 'playlist', title: 'MIT 6.034 Artificial Intelligence (Fall 2010)', by: 'MIT OpenCourseWare', topic: 'tech', origin: 'suggest', count: 30, about: 'Patrick Winston on classic AI: search, learning, constraints.', verified: true },
  { id: 'PLfBkt1-_BHX8kQZhisgrCLAnuAd3-Ek5U', kind: 'playlist', title: 'UC Berkeley CS161 Computer Security (Fall 2025)', by: 'CS 161 at UC Berkeley', topic: 'tech', origin: 'suggest', count: 15, about: 'Berkeley security course: memory safety, crypto, networks, web.', verified: true },

  // PSYCHOLOGY
  { id: 'PLWHJHzhtiAuS30X_NfVz37vXfZ-T3XyFK', kind: 'playlist', title: 'The Science of Well-Being', by: 'Dr. Laurie Santos (Yale)', topic: 'psy', origin: 'suggest', count: 31, about: 'Yale\'s most popular course: what actually makes people happier.', verified: true },
  { id: 'PL848F2368C90DDC3D', kind: 'playlist', title: 'Human Behavioral Biology', by: 'Robert Sapolsky (Stanford)', topic: 'psy', origin: 'suggest', count: 25, about: 'Why we do what we do, from genes and hormones to culture.', verified: true },
  { id: 'PL44ABC9278E2EE706', kind: 'playlist', title: 'MIT 9.00SC Introduction to Psychology (Fall 2011)', by: 'MIT OpenCourseWare', topic: 'psy', origin: 'suggest', count: 24, about: 'MIT intro to the mind, brain and behavior with John Gabrieli.', verified: true },

  // MINDSET
  { id: 'PLEA18FAF1AD9047B0', kind: 'playlist', title: 'Death', by: 'Shelly Kagan (Yale)', topic: 'mind', origin: 'suggest', count: 26, about: 'Yale philosophy of mortality and how to live well in its light.', verified: true },
  { id: 'PL3F6BC200B2930084', kind: 'playlist', title: 'Philosophy and the Science of Human Nature', by: 'Tamar Gendler (Yale)', topic: 'mind', origin: 'suggest', count: 26, about: 'Why people act as they do, from Plato to modern psychology.', verified: true },

  // COMMUNICATION
  { id: 'nalebuff-intro-negotiation', kind: 'link', url: 'https://www.coursera.org/learn/negotiation', title: 'Introduction to Negotiation: A Strategic Playbook', by: 'Barry Nalebuff (Yale, Coursera)', topic: 'comm', origin: 'suggest', about: 'Yale framework for principled, persuasive negotiating.', verified: true },
  { id: 'michigan-successful-negotiation', kind: 'link', url: 'https://www.coursera.org/learn/negotiation-skills', title: 'Successful Negotiation: Essential Strategies and Skills', by: 'University of Michigan (Coursera)', topic: 'comm', origin: 'suggest', about: 'Practical negotiation skills from the University of Michigan.', verified: true },
  { id: 'stanford-negotiation-webinar', kind: 'link', url: 'https://www.youtube.com/watch?v=7XTlcCvgijI', title: 'Negotiation: How to Get (More of) What You Want', by: 'Stanford Online', topic: 'comm', origin: 'suggest', about: 'Stanford webinar on negotiating better outcomes.', verified: true },
  { id: 'mit-how-to-speak', kind: 'link', url: 'https://www.youtube.com/watch?v=Unzc731iCUY', title: 'How to Speak', by: 'Patrick Winston (MIT OpenCourseWare)', topic: 'comm', origin: 'suggest', about: 'One famous MIT lecture on giving a talk people remember.', verified: true },
  { id: 'PLxq_lXOUlvQA3QmMA51Dtb1zR-qd-YVx9', kind: 'playlist', title: 'Lessons in Communication', by: 'Stanford Graduate School of Business', topic: 'comm', origin: 'suggest', count: 65, about: 'Short Stanford GSB talks on speaking, listening and influence.', verified: true },

  // ART
  { id: 'PLQTAp69rtoj2eiirBotPSgOwVnHvQ3zQT', kind: 'playlist', title: 'Digital Photography', by: 'Dan Armendariz (Harvard)', topic: 'art', origin: 'suggest', count: 11, about: 'Harvard course on how cameras work and how to shoot better.', verified: true },
  { id: 'PLBCB3059E45654BCE', kind: 'playlist', title: 'Roman Architecture', by: 'Diana Kleiner (Yale)', topic: 'art', origin: 'suggest', count: 24, about: 'Open Yale tour of Rome\'s buildings and what they say about power.', verified: true },
  { id: 'PLr4knI-rfpMeypqxLcNyVg29pSb69etSw', kind: 'playlist', title: 'MIT 4.605 A Global History of Architecture', by: 'Robert Cowherd (MIT)', topic: 'art', origin: 'suggest', count: 24, about: 'Architecture across cultures, from antiquity to today.', verified: true },
  { id: 'PLErBGbWC2wSP0rW4QLgdRjaLYJQtSxVAm', kind: 'playlist', title: 'David Gariff on 20th-Century Art', by: 'National Gallery of Art', topic: 'art', origin: 'suggest', count: 14, about: 'Gallery lecturer on modern art from Cezanne onward.', verified: true },
];
