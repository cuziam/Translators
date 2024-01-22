require("dotenv").config(); //.env파일을 읽어서 process.env에 넣어줌
const { EventEmitter } = require("events");
const translationEvents = new EventEmitter();
const {
  languageToISOCode,
  ISOCodeToLanguage,
  ISOCodeForTargetTool,
} = require("./util");

//통신 패키지
const axios = require("axios");

//보안
const xss = require("xss");

function sendEvents(req, res) {
  //응답 헤더 기본값 설정
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  //이벤트 리스너 콜백함수
  const onTranslationUpdate = (data) => {
    if (data[0].message === "done") {
      res.status(200).end();
      return;
    }
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  //이벤트리스너를 추가
  translationEvents.on("update", onTranslationUpdate);

  //만약 클라이언트가 연결을 끊으면 이벤트리스너를 제거
  res.on("close", () => {
    translationEvents.removeListener("update", onTranslationUpdate);
    res.end();
  });
}

//papago 번역 api
const translatePapago = async function (index, srcText, srcLang, targetLang) {
  console.log(srcText, srcLang, targetLang);
  const clientId = process.env.X_NCP_APIGW_API_KEY_ID;
  const clientSecret = process.env.X_NCP_APIGW_API_KEY;
  const apiUrl = "	https://naveropenapi.apigw.ntruss.com/nmt/v1/translation";

  const options = {
    method: "POST",
    url: apiUrl,
    headers: {
      "X-NCP-APIGW-API-KEY-ID": clientId,
      "X-NCP-APIGW-API-KEY": clientSecret,
    },
    data: {
      source: srcLang,
      target: ISOCodeForTargetTool(targetLang, "Papago"),
      text: srcText,
    },
  };
  try {
    const response = await axios(options);
    console.log(
      "papago 번역 성공: ",
      response.data.message.result.translatedText
    );
    translationEvents.emit("update", [
      {
        index: index,
        srcLang: ISOCodeToLanguage(srcLang),
        srcText: srcText,
        targetLang: ISOCodeToLanguage(targetLang),
        targetText: response.data.message.result.translatedText,
        targetTool: "Papago",
      },
    ]);
  } catch (error) {
    console.log("papago 번역 실패: ", error.response.data.error);
    const errorCode = error.response.data.error.errorCode;
    let textToSend;
    if (100 <= Number(errorCode) && Number(errorCode) <= 900) {
      textToSend = "Server Error: Sorry... Please try again later.";
    } else {
      textToSend = error.response.data.error.message;
    }
    translationEvents.emit("update", [
      {
        index: index,
        srcLang: ISOCodeToLanguage(srcLang),
        srcText: srcText,
        targetLang: ISOCodeToLanguage(targetLang),
        targetText: textToSend,
        targetTool: "Papago",
      },
    ]);
    throw error;
  }
};

//구글 번역 api
const { TranslationServiceClient } = require("@google-cloud/translate");
const translationClient = new TranslationServiceClient();

const projectId = process.env.GOOGLE_PROJECT_ID;
const location = process.env.GOOGLE_LOCATION;
const translateGoogle = async function (index, srcText, srcLang, targetLang) {
  console.log(srcText, srcLang, targetLang);
  const request = {
    parent: `projects/${projectId}/locations/${location}`,
    contents: [srcText],
    mimeType: "text/plain", // mime types: text/plain, text/html
    sourceLanguageCode: srcLang,
    targetLanguageCode: ISOCodeForTargetTool(targetLang, "Google Translator"),
  };
  try {
    const [response] = await translationClient.translateText(request);
    console.log("Google 번역 성공: ", response.translations[0].translatedText);
    translationEvents.emit("update", [
      {
        index: index,
        srcLang: ISOCodeToLanguage(srcLang),
        srcText: srcText,
        targetLang: ISOCodeToLanguage(targetLang),
        targetText: response.translations[0].translatedText,
        targetTool: "Google Translator",
      },
    ]);
  } catch (error) {
    console.log("Google 번역 실패: ", error);
    translationEvents.emit("update", [
      {
        index: index,
        srcLang: ISOCodeToLanguage(srcLang),
        srcText: srcText,
        targetLang: ISOCodeToLanguage(targetLang),
        targetText: error.details,
        targetTool: "Google Translator",
      },
    ]);
    throw error;
  }
};

//deepl 번역 api
const deepl = require("deepl-node");
const authKey = process.env.DEEPL_AUTH_KEY;
const translator = new deepl.Translator(authKey);
const translateDeepl = async function (index, srcText, srcLang, targetLang) {
  console.log(srcText, srcLang, targetLang);
  try {
    const response = await translator.translateText(
      srcText,
      srcLang,
      targetLang
    );
    console.log("DeepL 번역 성공: ", response.text);
    translationEvents.emit("update", [
      {
        index: index,
        srcLang: ISOCodeToLanguage(srcLang),
        srcText: srcText,
        targetLang: ISOCodeToLanguage(targetLang),
        targetText: response.text,
        targetTool: "DeepL",
      },
    ]);
  } catch (error) {
    console.log("DeepL 번역 실패:", error);
    translationEvents.emit("update", [
      {
        index: index,
        srcLang: ISOCodeToLanguage(srcLang),
        srcText: srcText,
        targetLang: ISOCodeToLanguage(targetLang),
        targetText: error.message,
        targetTool: "DeepL",
      },
    ]);
    throw error;
  }
};

const translateClientReq = async function (reqBody) {
  console.log("translateClientReq");
  const translationResults = [];

  for (const config of reqBody) {
    let { srcLang, srcText, targetLang, targetTool, index } = config;
    srcLang = languageToISOCode(srcLang);
    srcText = xss(srcText);
    targetLang = languageToISOCode(targetLang);

    let result;
    switch (targetTool) {
      case "Papago":
        result = await translatePapago(index, srcText, srcLang, targetLang)
          .then(() => true)
          .catch(() => false);
        break;
      case "Google":
        result = await translateGoogle(index, srcText, srcLang, targetLang)
          .then(() => true)
          .catch(() => false);
        break;
      case "DeepL":
        result = await translateDeepl(index, srcText, srcLang, targetLang)
          .then(() => true)
          .catch(() => false);
        break;
      default:
        break;
    }
    translationResults.push(result);
  }
  translationEvents.emit("update", [
    {
      message: "done",
    },
  ]);
  return translationResults;
};

module.exports = {
  translatePapago,
  translateGoogle,
  translateDeepl,
  translateClientReq,
  sendEvents,
};
