#!/usr/bin/env node
/**
 * Kahoot Bot Tool - v2.0.0
 * All-in-one local script: flood, auto-answer, score tracking, reconnect
 *
 * Usage:
 *   node tool.js <pin> <name> [count]
 *
 * Controls:
 *   1/2/3/4 = manual answer (overrides auto)
 *   s = skip / next question
 *   q = quit
 */
const Kahoot = require('kahoot.js-latest');
const readline = require('readline');

const PIN = process.argv[2];
const NAME = process.argv[3] || 'Bot';
const COUNT = parseInt(process.argv[4]) || 1;

if (!PIN) {
    console.log('Usage: node tool.js <pin> <name> [count]');
    process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', (line) => {
    const cmd = line.trim().toLowerCase();
    if (cmd === 'q' || cmd === 'quit') process.exit(0);
    if (/^[1234]$/.test(cmd)) {
        const choice = parseInt(cmd) - 1;
        bots.forEach(b => {
            if (!b.answered) {
                b.answered = true;
                b.client.answer(choice, Math.floor(Math.random() * 2000) + 500)
                    .then(() => console.log(`[${b.name}] manual answer: ${choice}`))
                    .catch(e => console.log(`[${b.name}] answer error: ${e.message || e}`));
            }
        });
    }
    if (cmd === 's') {
        bots.forEach(b => b.answered = false);
        console.log('[*] reset answer flags');
    }
});

const bots = [];

function createBot(name, index) {
    const client = new Kahoot();
    client.loggingMode = false;
    const bot = { client, name, answered: false, score: 0, streak: 0, rank: 0 };

    client.on('Joined', (settings) => {
        console.log(`[${name}] joined (challenge=${!!settings.isChallenge}, type=${settings.gameType || 'normal'})`);
    });

    client.on('QuizStart', (event) => {
        const qCount = event.quizQuestionAnswers ? event.quizQuestionAnswers.length : '?';
        const qType = event.quizType || 'unknown';
        console.log(`[${name}] QUIZ START: ${qCount} questions, type=${qType}`);
    });

    client.on('QuestionReady', (event) => {
        bot.answered = false;
        const qIdx = event.questionIndex;
        const nc = (event.quizQuestionAnswers && event.quizQuestionAnswers[qIdx]) || 4;
        console.log(`[${name}] Q${qIdx} ready (${nc} choices, type=${event.gameBlockType})`);
    });

    client.on('QuestionStart', (event) => {
        const qIdx = event.questionIndex;
        const nc = (event.quizQuestionAnswers && event.quizQuestionAnswers[qIdx]) || 4;
        const qType = event.gameBlockType || 'quiz';
        const time = event.timeAvailable || 20000;
        console.log(`[${name}] Q${qIdx} START: type=${qType}, choices=${nc}, time=${time}ms`);

        // auto-answer: random choice, random delay 1-5s
        if (!bot.answered) {
            let choice;
            switch (qType) {
                case 'multiple_select_quiz':
                case 'multiple_select_poll': {
                    const picks = Math.floor(Math.random() * Math.min(3, nc)) + 1;
                    const all = Array.from({ length: nc }, (_, i) => i);
                    for (let x = all.length - 1; x > 0; x--) {
                        const y = Math.floor(Math.random() * (x + 1));
                        [all[x], all[y]] = [all[y], all[x]];
                    }
                    choice = all.slice(0, picks);
                    break;
                }
                case 'jumble':
                    choice = [0, 1, 2, 3];
                    break;
                case 'word_cloud':
                case 'open_ended':
                    choice = Math.floor(Math.random() * nc);
                    break;
                default:
                    choice = Math.floor(Math.random() * nc);
            }
            const delay = Math.floor(Math.random() * 4000) + 1000;
            console.log(`[${name}] auto-answer in ${delay}ms: ${JSON.stringify(choice)}`);
            setTimeout(() => {
                if (!bot.answered) {
                    bot.answered = true;
                    client.answer(choice, Math.floor(Math.random() * 2000) + 500)
                        .then(() => console.log(`[${name}] answered: ${JSON.stringify(choice)}`))
                        .catch(e => console.log(`[${name}] answer error: ${JSON.stringify(e)}`));
                }
            }, delay);
        }
    });

    client.on('QuestionEnd', (event) => {
        if (event.hasAnswer === false) {
            console.log(`[${name}] Q${event.questionIndex} no answer sent`);
            return;
        }
        bot.score = event.totalScore;
        bot.rank = event.rank;
        bot.streak = event.pointsData ? event.pointsData.answerStreakPoints.streakLevel : 0;
        const correct = event.isCorrect ? 'CORRECT' : 'WRONG';
        const pts = event.points || 0;
        console.log(`[${name}] Q${event.questionIndex} END: ${correct} +${pts}pts | total=${bot.score} rank=${bot.rank} streak=${bot.streak}`);
    });

    client.on('QuizEnd', (event) => {
        console.log(`[${name}] QUIZ END: score=${bot.score}, rank=${bot.rank}`);
    });

    client.on('Podium', (event) => {
        const medal = event.podiumMedalType || 'none';
        console.log(`[${name}] PODIUM: medal=${medal}`);
    });

    client.on('Feedback', () => {
        // auto-send feedback: 5/1/1/1
        client.sendFeedback(5, 1, 1, 1).catch(() => {});
    });

    client.on('TimeOver', (event) => {
        console.log(`[${name}] TIME OVER for Q${event.questionNumber}`);
    });

    client.on('Disconnect', (reason) => {
        console.log(`[${name}] DISCONNECT: ${reason}`);
    });

    client.on('TwoFactorReset', () => {
        console.log(`[${name}] 2FA required, auto-answering...`);
        client.answerTwoFactorAuth([0, 1, 2, 3]).catch(() => {});
    });

    client.on('GameReset', () => {
        console.log(`[${name}] GAME RESET (play again)`);
        bot.score = 0;
        bot.streak = 0;
        bot.rank = 0;
    });

    return bot;
}

async function main() {
    console.log(`\nkahoot-gefickt v2.0.0`);
    console.log(`flood: ${PIN} / ${COUNT} bots as "${NAME}"\n`);
    console.log('Controls: 1/2/3/4=answer, s=skip, q=quit\n');

    for (let i = 0; i < COUNT; i++) {
        const name = COUNT === 1 ? NAME : `${NAME}${i + 1}`;
        const bot = createBot(name, i);
        bots.push(bot);

        bot.client.join(PIN, name)
            .then(() => console.log(`[${name}] ready`))
            .catch(e => {
                console.log(`[${name}] FAILED: ${JSON.stringify(e)}`);
            });

        await sleep(200);
    }

    // Print scoreboard every 10s
    setInterval(() => {
        if (bots.length === 0) return;
        const sorted = [...bots].sort((a, b) => b.score - a.score);
        console.log('\n=== SCOREBOARD ===');
        sorted.forEach((b, i) => {
            console.log(`  #${i + 1} ${b.name}: ${b.score} pts (streak=${b.streak})`);
        });
        console.log('==================\n');
    }, 10000);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error(e); process.exit(1); });
