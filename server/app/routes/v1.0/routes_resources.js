/*
 Copyright [2016] [Relevance Lab]

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

var resourceService = require('_pr/services/resourceService');
var async = require('async');
var apiUtil = require('_pr/lib/utils/apiUtil.js');

module.exports.setRoutes = function(app, sessionVerificationFunc) {
    app.all("/resources/*", sessionVerificationFunc);

    app.get('/resources', getAWSResources);

    /**
     * Lists all tracked(managed+unmanaged) instances.
     * Pagination not supported. Only search and filterBy supported.
     *
     * @param req
     * @param res
     * @param next
     */
    function getAWSResources(req, res, next) {
            var reqData = {};
            async.waterfall(
                [

                    function(next) {
                        apiUtil.paginationRequest(req.query, 'resources', next);
                    },
                    function(paginationReq, next) {
                        reqData = paginationReq;
                        apiUtil.databaseUtil(paginationReq, next);
                    },
                    function(queryObj, next) {
                        resourceService.getResources(queryObj, next);
                    },
                    function(resources, next) {
                        apiUtil.paginationResponse(resources[0],reqData, next);
                    }

                ], function(err, results) {
                    if (err)
                        next(err);
                    else
                        return res.status(200).send(results);
                });
        }
};