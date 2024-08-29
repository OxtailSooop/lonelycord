import {
    Ollama
} from "ollama";

import moment from 'moment-timezone';

import {
    Client,
    Events,
    GatewayIntentBits,
    Message,
    User,
    Role,
    PresenceUpdateStatus,
    ActivityType,
} from "discord.js";

// undocumented: expect this to fuck up, Makes the bot appear as though it is on a phone
const {
    DefaultWebSocketManagerOptions: {
        identifyProperties
    }
} = require("@discordjs/ws");

identifyProperties.browser = "Discord iOS";

const ollama: Ollama = new Ollama({
    host: "http://localhost:11434",
});

let afk: boolean = false;
let afkTimeout: NodeJS.Timeout;
let opportunity = true;
let sleeping = false;
let context: any;
const { DISCORD_TOKEN } = process.env;


const client: Client<true> = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ],
});

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function between(number: number, min: number, max: number): boolean {
    return number >= min && number <= max;
}

function sleepIfShouldSleep() {
    const currentTime = moment().tz("Asia/Tokyo");
    if (between(currentTime.hour(), 0, 7) && !sleeping) {
        sleeping = true;
        console.log("[I] Oyasumi 🥱");

        client.user.setStatus(PresenceUpdateStatus.Invisible);
    } else if (!between(currentTime.hour(), 0, 7) && sleeping) {
        sleeping = false;
        console.log("[I] Ohayo 😊");

        client.user.setStatus(PresenceUpdateStatus.Online);
        client.user.setActivity('Going about life.', { type: ActivityType.Custom });
    }
}

function setAFK(set: boolean) {
    if (set) {
        console.log("[I] No one has interacted to me in 3 minutes, Appearing as offline.");
        client.user.setStatus(PresenceUpdateStatus.Invisible);
        afk = true;
    } else {
        client.user.setStatus(PresenceUpdateStatus.Online);
        afk = false;
    }
}

function convertMentionsToNames(message: Message) {
    let content: string = message.content;

    message.mentions.users.each((user: User) => {
        content = content.replace("<@" + user.id + ">", user.displayName);
        content = content.replace("<@!" + user.id + ">", user.displayName); // deprecated shit from discord
    });

    message.mentions.channels.each((channel) => {
        content = content.replace("<#" + channel.id + ">", channel.name);
    });

    message.mentions.roles.each((role: Role) => {
        content = content.replace("<@&" + role.id + ">", role.name);
    });

    return content;
}

client.once(Events.ClientReady, async (readyClient: Client<true>) => {
    opportunity = false;

    console.log(`[I] Logged in as ${readyClient.user.tag}`);

    sleepIfShouldSleep();

    setInterval(sleepIfShouldSleep, 600000);
    afkTimeout = setTimeout(setAFK, 180000, true);

    console.log("[I] Ready!");

    opportunity = true;
});

// TODO: prompts and responses for training and keep the context variable somewhere when the bot gets restarted (postgres)
client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot || !message.mentions.has(client.user) || !opportunity/* || sleeping*/) {
        return;
    }

    opportunity = false;

    clearTimeout(afkTimeout); // dont want it ticking while the prompt is generating

    let prompt: string = convertMentionsToNames(message);

    // bs we have to do to get the bot to type for how long we want
    message.channel.sendTyping();
    const typingInterval = setInterval(() => message.channel.sendTyping(), 9500);

    await ollama.generate({
        model: "llama3.1",
        prompt: prompt,
        stream: false,
        context: context,
    }).then((response) => {
        // add a slight delay if we were afk
        if (afk) {
            setAFK(false);
            delay(3500);
        }

        if (response.response.length > 2000) {
            console.log("[W] Response too big (over 2000 chars)");
        } else {
            message.reply(response.response);
            context = response.context;
        }

        clearInterval(typingInterval);

        afkTimeout = setTimeout(setAFK, 180000, true);
        opportunity = true;
    }).catch(console.error);
});

if (!DISCORD_TOKEN) {
    console.log("Missing DISCORD_TOKEN");
}

console.log("[I] Updating llama...");
await ollama.pull({ model: "llama3.1" });

client.login(DISCORD_TOKEN);
