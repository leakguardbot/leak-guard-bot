const { Telegraf, Markup, Composer } = require('telegraf');
const Jimp = require('jimp');

const groupChatId = process.env.GROUP_CHAT_ID;
const adminId = process.env.ADMIN_ID.split(',').map((item) => parseInt(item));
const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const publishedPhotos = {};

const $_ = {
  help: 'Hello! Send me a photo to start watermarking.',
  noPhotoError: 'Sorry, I don’t see a photo in your message.\n\nPlease send a photo to start watermarking.',
  videoError: 'Sorry, only still photos are supported at this time.',
  notAdminError: 'Sorry, only pre-approved admins can publish.',
  publishButton: '✅ Publish',
  deleteButton: '❌ Delete',
  readyToPublish: 'Ready to publish',
  publishConfirmation: 'This photo has been published.',
  publishedPhotoCaption: 'New photo available ✨',
  getPhotoButton: '⬇️ Get it',
  photoUnavailable: 'Sorry, the photo you requested is no longer available.',
  deliveryCaption: 'Here is the photo you requested 📸',
  helpKeywords: [
    'hi',
    'hello',
    'hey',
    'help',
  ],
};

const publishKeyboard = Markup.inlineKeyboard([
  Markup.button.callback($_.publishButton, 'publish'),
  Markup.button.callback($_.deleteButton, 'delete')
]);

// basic responses
bot.start((ctx) => ctx.reply($_.help));
bot.help((ctx) => ctx.reply($_.help));

// handle photos
bot.on('photo', (ctx) => {
  // clean up original
  ctx.deleteMessage();

  // show UI
  ctx.replyWithPhoto(
    ctx.message.photo[0].file_id,
    {
      caption: (ctx.message.caption ? ctx.message.caption + '\n\n' : '') + $_.readyToPublish,
      reply_markup: publishKeyboard.reply_markup,
    },
  );
});

function matchesHelpMessage(text) {
  const keywords = $_.helpKeywords;

  if (text && text.length > 0) {
    return keywords.includes(text.trim().toLowerCase());
  } else {
    return false;
  }
}

// handle messages
bot.on('message', (ctx) => {
  if (matchesHelpMessage(ctx.message.text)) {
    // greetings or requests for help
    ctx.reply($_.help);
  } else if (ctx.message.text) {
    // all other text messages
    ctx.reply($_.noPhotoError);
  } else if (ctx.message.animation || ctx.message.video) {
    ctx.reply($_.videoError);
  } else {
    // service messages, etc
    // ignore
  }
});

function isFromApprovedUser(ctx) {
  const from = ctx.from.id;
  return adminId === from || (adminId.includes && adminId.includes(from));
}

// publish only runs for users with pre-approved IDs
bot.action('publish', Telegraf.branch(isFromApprovedUser,
  // approved
  async (ctx) => {
    ctx.telegram.sendChatAction(groupChatId, 'upload_photo');

    // download and pixelate photo
    const caption = (ctx.callbackQuery.message.caption || '')
      .replace($_.readyToPublish, '')
      .replace($_.publishConfirmation, '')
      .trim();
    const photoSizes = ctx.callbackQuery.message.photo;
    const photoFileId = photoSizes[photoSizes.length - 1].file_id;
    const photoFileUniqueId = photoSizes[photoSizes.length - 1].file_unique_id;
    const photoFileInfo = await ctx.telegram.getFileLink(photoFileId);
    const photo = await Jimp.read(photoFileInfo.href);
    photo.pixelate(photo.bitmap.width / 24);

    // send pixelated photo to group chat
    const publishedPhoto = await ctx.telegram.sendPhoto(groupChatId, {
      source: await photo.getBufferAsync(Jimp.AUTO),
    }, {
      caption: (caption ? caption : $_.publishedPhotoCaption),
      reply_markup: {
        inline_keyboard: [[
          {
            text: $_.getPhotoButton,
            callback_data: `photo_id:${photoFileUniqueId}`,
          }
        ]]
      },
    });

    // remember photo key
    publishedPhotos[photoFileUniqueId] = photoFileId;

    // confirm
    const confirmCaption = (caption ? caption + '\n\n' : '') + $_.publishConfirmation;
    if (confirmCaption !== ctx.callbackQuery.message.caption) {
      ctx.editMessageCaption(confirmCaption, publishKeyboard);
    }
  },

  // non-approved
  (ctx, next) => {
    ctx.reply($_.notAdminError);
  }
));

bot.action('delete', (ctx) => {
  // remove reference if published
  const photoSizes = ctx.callbackQuery.message.photo;
  const photoFileUniqueId = photoSizes[photoSizes.length - 1].file_unique_id;
  delete publishedPhotos[photoFileUniqueId];

  ctx.deleteMessage();
});

// handle watermarked photo requests
bot.action(/^photo_id:/, async (ctx) => {
  const data = ctx.callbackQuery.data;
  const id = data.substring(9);
  const publishedId = publishedPhotos[id];
  const recipient = ctx.callbackQuery.from;
  const caption = (ctx.callbackQuery.message.caption || '')
    .replace($_.publishedPhotoCaption, '')
    .trim();

  if (publishedId != null) {
    // show loading message
    ctx.telegram.sendChatAction(recipient.id, 'upload_photo');

    // set up photo editing
    const photoFileInfo = await ctx.telegram.getFileLink(publishedId);
    const photo = await Jimp.read(photoFileInfo.href);
    const photo2 = photo.clone();
    const lightFont = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
    const darkFont = await Jimp.loadFont(Jimp.FONT_SANS_64_BLACK);
    const lightFontSm = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    const darkFontSm = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
    const username = recipient.username;
    const userId = recipient.id.toString();
    const bigText = username || userId;
    const smText = username ? userId : null;
    const overlayText = {
      text: bigText,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
      alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE,
    };
    const overlayTextSm = smText ? {
      text: smText,
      alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
      alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE,
    } : null;
    const textSmOffset = Jimp.measureTextHeight(lightFont, bigText);

    // apply watermark with shadow and opacity
    photo
      .print(darkFont, 1, 1, overlayText, photo.bitmap.width, photo.bitmap.height)
      .print(lightFont, 0, 0, overlayText, photo.bitmap.width, photo.bitmap.height);

    // apply secondary watermark if needed
    if (overlayTextSm) {
      photo
        .print(darkFontSm, 1, textSmOffset / 1.5, overlayTextSm, photo.bitmap.width, photo.bitmap.height)
        .print(lightFontSm, 0, textSmOffset / 1.5 - 1, overlayTextSm, photo.bitmap.width, photo.bitmap.height);
    }

    // fade the overlay
    photo.composite(photo2, 0, 0, { opacitySource: .7 });

    // DM the watermarked photo
    ctx.telegram.sendPhoto(recipient.id, {
      source: await photo.getBufferAsync(Jimp.AUTO),
    }, {
      caption: caption || $_.deliveryCaption,
    });
  } else {
    ctx.telegram.sendMessage(recipient.id, $_.photoUnavailable);
  }
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
