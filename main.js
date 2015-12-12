import http from 'http';
import https from 'https';
import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import logger from 'express-logger';
import fs from 'fs';
import path  from 'path';
import simpleGit from 'simple-git';
import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github';
import config from 'cnf';
import url from 'url';
import mkdirp from 'mkdirp';
import jsonPatch from 'json-patch';
import * as auth from './auth';
import * as error from './error';
import * as projects from './projects';
import * as users from './users';
import * as mongodb from './mongodb';
import { makeSerializeUser, makeDeserializeUser, makeGitHubStrategyCallback } from './passport';
import { Repository, Signature } from 'nodegit';
import GitHubApi from 'github';

async function main() {
  try {
    let app = express();
    let db = await mongodb.connectToMongoDB(config.mongodb.connectionString);

    passport.serializeUser(makeSerializeUser());
    passport.deserializeUser(makeDeserializeUser(users.makeGetUser(db)));
    passport.use(new GitHubStrategy({
        clientID: config.github.client_id,
        clientSecret: config.github.client_secret,
        callbackURL: config.github.callback_url
      },
      makeGitHubStrategyCallback(users.makeGetUserGitHubRepositories(new GitHubApi({version: '3.0.0'})), users.makeUpdateUserGitHub(db))
    ));

    app.use(logger(config.logger));
    app.use(cookieParser());
    app.use(bodyParser.json());
    app.use(session(config.session));
    app.use(passport.initialize());
    app.use(passport.session());

    app.use('/', express.static('./public'));
    app.get('/login', auth.makeLoginRouteHandler('/auth/github'));
    app.get('/logout', auth.makeLogoutRouteHandler('/'));
    app.get('/auth/github', auth.makeAuthGithubRouteHandler(passport));
    app.get('/auth/github/callback',
      auth.makeAuthGithubCallbackMiddleware(passport, '/'),
      auth.makeAuthGithubCallbackRouteHandler('/app')
    );

    app.use('/api', auth.makeIsAuthenticatedMiddleware());
    app.get('/api/user/profile', users.makeGetUserProfileRouteHandler(users.makeGetUserProfile(db)));
    app.post('/api/user/profile', users.makePostUserProfileRouteHandler(users.makeUpdateUserProfile(db)));
    app.get('/api/user/repositories', users.makeGetUserRepositoriesRouteHandler(users.makeGetUserRepositories(db)));
    app.get('/api/user/settings', users.makeGetUserSettingsRouteHandler(users.makeGetUserSettings(db)));
    app.post('/api/user/settings', users.makePostUserSettingsRouteHandler(users.makeUpdateUserSettings(db)));
    app.get('/api/projects', projects.makeGetProjectsRouteHandler(projects.makeGetProjects(db)));
    app.post('/api/projects', projects.makePostProjectsRouteHandler(projects.makeCreateProject(db)));
    app.get('/api/projects/:projectId/settings', projects.makeGetProjectSettingsRouteHandler(projects.makeGetProjectSettings(db)));
    app.post('/api/projects/:projectId/settings', projects.makePostProjectSettingsRouteHandler(projects.makeUpdateProjectSettings(db)));
    app.get('/api/projects/:projectId/repository/texts', projects.makeGetProjectRepositoryTextsRouteHandler(config.data, path, fs, url, mkdirp, simpleGit, new projects.makeGetProject(db)));
    app.patch('/api/projects/:projectId/repository/texts', projects.makePatchProjectRepositoryTextsRouteHandler(config.data, path, fs, jsonPatch, Repository, Signature));
    app.post('/api/projects/:projectId/repository/sync', projects.makePostProjectRepositorySyncRouteHandler(config.data, path, url, new projects.makeGetProject(db), simpleGit));

    app.use(error.makeErrorMiddleware());

    let httpServer = http.createServer(app);
    let httpsServer = https.createServer({
      ca: config.ssl.ca.map(path => fs.readFileSync(path, 'utf8')),
      key: fs.readFileSync(config.ssl.key, 'utf8'),
      cert: fs.readFileSync(config.ssl.cert, 'utf8'),
      passphrase: config.ssl.passphrase
    }, app);

    httpServer.listen(80, () => { console.log('Listening on port 80'); });
    httpsServer.listen(443, () => { console.log('Listening on port 443'); });
  } catch (ex) {
    console.log(ex, ex.stack);
  }
}

main();