import { Request } from 'express';
import fs from 'fs';
import { constants } from 'fs/promises';
import tar from 'tar';

import { ServerOptions } from '../types/ServerOptions';
// import CreateSessionUtil from '../util/createSessionUtil';

const MAX_RETRIES = 5;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SESSIONS_PATH = (serverOptions: ServerOptions) =>
  `../../../${serverOptions.efsMountContainerPath}/archives`;

// const TOKENS_PATH = (serverOptions: ServerOptions) =>
//   `../../../${serverOptions.efsMountContainerPath}/tokens`;

// * List of routes to ignore archive/extract
const archiveIgnoreRoutes: string[] = [
  '/logout-session',
  '/clear-session-data',
  // '/close-session',
];

// * Utility promise to check path to file/dir exists or not (fs)
async function isExists(req: Request, target: string): Promise<boolean> {
  return new Promise((resolve) => {
    fs.access(target, constants.F_OK, async (err) => {
      req.logger.info(`isExists::${target} ${err}`);
      if (err) return resolve(false);
      return resolve(true);
    });
  });
}

async function archiveSession(req: Request, serverOptions: ServerOptions) {
  const customerId = req.session;
  req.logger.info(`archiveSession::ZIP SESSION::${customerId}`);
  const DATA_PATH = serverOptions.customUserDataDir;
  let successFullyZipped = false;
  let retries = 0;
  while (!successFullyZipped) {
    try {
      // create SESSIONS_PATH directory if it doesn't exist
      const dirPath = SESSIONS_PATH(serverOptions);
      req.logger.info(`archiveSession::dirPath ${dirPath}`);
      if (!(await isExists(req, dirPath))) {
        req.logger.info(`archiveSession::create dir ${dirPath}`);
        await fs.mkdir(dirPath, (err) => {
          req.logger.info(`archiveSession::mkdir-error::${err}`);
        });
      }
      // // create TOKENS_PATH directory if it doesn't exist
      // const tokenPath = TOKENS_PATH(serverOptions);
      // req.logger.info(`archiveSession::tokenPath ${tokenPath}`);
      // if (!(await isExists(req, tokenPath))) {
      //   req.logger.info(`archiveSession::create dir ${tokenPath}`);
      //   await fs.mkdir(tokenPath, (err) => {
      //     req.logger.info(`archiveSession::mkdir-error::${err}`);
      //   });
      // }

      const filePath = `${dirPath}/${customerId}.zip`;
      req.logger.info(`archiveSession::filePath ${filePath}`);
      req.logger.info(`archiveSession::cwd ${process.cwd()}`);
      await tar.c({ file: filePath, cwd: DATA_PATH }, [`${customerId}`]);
      successFullyZipped = true;
      req.logger.info(`archiveSession::zip complete`);
      // // copy token
      // const tokenSrc = `/home/node/app/tokens/${customerId}.data.json`;
      // const tokenDest = `${tokenPath}/${customerId}.data.json`;
      // fs.copyFile(tokenSrc, tokenDest, (err) => {
      //   if (err) req.logger.error(`archiveSession:: copy token error ${err}`);
      //   req.logger.info('archiveSession::Token copied');
      // });
      // try {
      //   await req.client.isConnected();
      // } catch (error) {
      //   console.log('archiveSession::not connected');
      //   // const util = new CreateSessionUtil();
      //   // await util.opendata(req, req.session);
      //   // req.logger.info('archiveSession::connection opened');
      // }
    } catch (error) {
      req.logger.error(`Error in zipSession: ${JSON.stringify(error)}`);
      if (retries > MAX_RETRIES) {
        req.logger.error('Maximum number of retries reached. Exiting.');
        break;
      }
      // increasing delayTime with every retry (exponential back-off)
      const delayTime = Math.pow(2, retries) * 1000;
      req.logger.info(`Retrying in ${delayTime / 1000} seconds...`);
      await delay(delayTime);
      retries += 1;
    }
  }
  return;
}

async function extractSession(req: Request, serverOptions: ServerOptions) {
  const customerId = req.session;
  req.logger.info(`extractSession::UNZIP SESSION::${customerId}`);
  const fileName = `${customerId}.zip`;

  const target = `${SESSIONS_PATH(serverOptions)}/${fileName}`;

  const DATA_PATH = serverOptions.customUserDataDir;

  if (await isExists(req, target)) {
    let successFullyUnZipped = false;
    let retries = 0;
    while (!successFullyUnZipped) {
      try {
        await tar.x({
          file: target,
          cwd: DATA_PATH,
        });
        req.logger.info(`extractSession::target ${target}`);
        req.logger.info(`extractSession::cwd ${SESSIONS_PATH(serverOptions)}`);
        successFullyUnZipped = true;
        req.logger.info(`extractSession::unzip complete`);
      } catch (error) {
        req.logger.error(
          `extractSession::Error in unZipSession: ${JSON.stringify(error)}`
        );
        if (retries > MAX_RETRIES) {
          req.logger.error('Maximum number of retries reached. Exiting.');
          break;
        }
        // increasing delayTime with every retry (exponential back-off)
        const delayTime = Math.pow(2, retries) * 1000;
        req.logger.info(`Retrying in ${delayTime / 1000} seconds...`);
        await delay(delayTime);
        retries += 1;
      }
    }
  } else {
    req.logger.info('extractSession::extract skipped, file not found');
  }
  // try {
  //   await req.client.isConnected();
  // } catch (error) {
  //   console.log('extractSession::not connected');
  //   // const util = new CreateSessionUtil();
  //   // await util.opendata(req, req.session);
  // }
}

async function discardSessionArchive(
  req: Request,
  serverOptions: ServerOptions
) {
  const customerId = req.session;
  req.logger.info(`discardSessionArchive::${customerId}`);
  const fileName = `${customerId}.zip`;

  const target = `${SESSIONS_PATH(serverOptions)}/${fileName}`;
  req.logger.info(`discardSessionArchive::target ${target}`);
  fs.access(target, constants.F_OK, async (err) => {
    if (err) {
      req.logger.error(
        `discardSessionArchive::archive not found at '${target}' to discard`
      );
    } else {
      await fs.unlink(target, (err) => {
        if (err)
          req.logger.error(
            `discardSessionArchive::target: ${target} delete error, ${err}`
          );
        else
          req.logger.error(`discardSessionArchive::target: ${target} removed`);
      });
    }
  });
}

export async function handleOnInit(req: Request) {
  // unZip
  req.logger.info(
    `handleOnInit::req.session::${req.session}, req.params.session::${req.params.session}`
  );
  if (req.session) {
    const path: string = req.originalUrl;
    req.logger.info(
      `handleOnInit::archiveIgnoreRoutes::${archiveIgnoreRoutes.some((r) =>
        path.includes(r)
      )}`
    );
    if (!archiveIgnoreRoutes.some((r) => path.includes(r))) {
      req.logger.info('handleOnInit::unzip');
      await extractSession(req, req.serverOptions);
    }
  }
}

export async function handleOnFinish(req: Request) {
  // Zip here for all/filter the requests
  if (req.session) {
    const path: string = req.originalUrl;
    if (archiveIgnoreRoutes.some((r) => path.includes(r))) {
      req.logger.info('handleOnFinish::discard');
      await discardSessionArchive(req, req.serverOptions);
    } else {
      const customerId = req.session;
      const userDataDirPath = `${req.serverOptions.customUserDataDir}${customerId}`;
      const exists = await isExists(req, userDataDirPath);
      if (exists) {
        req.logger.info('handleOnFinish::zip');
        await archiveSession(req, req.serverOptions);
      } else {
        req.logger.info('handleOnFinish::ignore zip');
      }
    }
  }
}
