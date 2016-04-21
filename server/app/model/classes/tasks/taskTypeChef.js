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


var logger = require('_pr/logger')(module);
var mongoose = require('mongoose');
var extend = require('mongoose-schema-extend');
var ObjectId = require('mongoose').Types.ObjectId;

var instancesDao = require('../instance/instance');
var logsDao = require('../../dao/logsdao.js');
var credentialCryptography = require('../../../lib/credentialcryptography')
var fileIo = require('../../../lib/utils/fileio');
var configmgmtDao = require('../../d4dmasters/configmgmt.js');

var Chef = require('../../../lib/chef');

var taskTypeSchema = require('./taskTypeSchema');

var ChefClientExecution = require('../instance/chefClientExecution/chefClientExecution.js');
var utils = require('../utils/utils.js');
var Blueprints = require('_pr/model/blueprint');
var AppData = require('_pr/model/app-deploy/app-data');
var masterUtil = require('../../../lib/utils/masterUtil.js');

var chefTaskSchema = taskTypeSchema.extend({
    nodeIds: [String],
    runlist: [String],
    attributes: [{
        name: String,
        jsonObj: {}
    }]
});

//Instance Methods :- getNodes
chefTaskSchema.methods.getNodes = function() {
    return this.nodeIds;

};

// Instance Method :- run task
chefTaskSchema.methods.execute = function(userName, baseUrl, choiceParam, appData, blueprintIds, envId, onExecute, onComplete) {
    logger.debug("chef appData: ", JSON.stringify(appData));
    var self = this;
    logger.debug("self: ", JSON.stringify(self));
    if (blueprintIds[0] != "" && blueprintIds.length) {
        var count = 0;
        var onCompleteResult = [];
        var overallStatus = 0;
        var launchedBluprintIds = [];
        var failedBluprintIds = [];

        function blueprintOnCompleteHandler(err, status, blueprintId, output) {
            count++;
            var result = {
                blueprintId: blueprintId,
                result: output,
                status: 'success'
            };
            if (status) {
                result.status = 'failed';
                overallStatus = 1;
                failedBluprintIds.push(blueprintId);
            } else {
                launchedBluprintIds.push(blueprintId);
            }
            onCompleteResult.push(result);

            if (count === blueprintIds.length) {
                if (typeof onExecute === 'function') {
                    var msg;
                    if (!launchedBluprintIds.length) {
                        msg = "Unable to launch blueprints";
                    } else if (launchedBluprintIds.length === blueprintIds.length) {
                        msg = "Your Selected Blueprint is being Launched,You can monitor logs from the Launched Instances.";
                    } else {
                        msg = "You can monitor logs from the Launched Instances.";
                    }
                    onExecute(null, {
                        blueprintMessage: msg,
                        onCompleteResult: onCompleteResult
                    });
                }

                if (typeof onComplete === 'function') {
                    process.nextTick(function() {
                        logger.debug("onComplete fired for blueprint: ", overallStatus + "  " + onCompleteResult);
                        onComplete(null, overallStatus, {
                            blueprintResults: onCompleteResult
                        });
                    });
                }
            }
        }
        Blueprints.getByIds(blueprintIds, function(err, blueprints) {
            if (err) {
                logger.error("Failed to get blueprints", err);
                onExecute({
                    message: "Failed to get blueprints"
                });
                return;
            }
            if (!blueprints.length) {
                onExecute({
                    message: "Blueprints not found"
                });
                return;
            }
            for (var i = 0; i < blueprints.length; i++) {
                (function(blueprint) {
                    blueprint.extraRunlist = self.runlist;
                    logger.debug("envId=== ", envId);
                    blueprint.launch({
                        envId: envId,
                        ver: null,
                        stackName: null,
                        sessionUser: userName
                    }, function(err, launchData) {
                        var status = 0;
                        if (err) {
                            logger.error('blueprint launch error. blueprint id ==>', blueprint.id, err);
                            status = 1;
                        }
                        blueprintOnCompleteHandler(err, status, blueprint.id, launchData);
                    });
                })(blueprints[i]);
            }

        });

        return;

    } else {
        //merging attributes Objects
        var attributeObj = {};
        var objectArray = [];
        for (var i = 0; i < self.attributes.length; i++) {
            objectArray.push(self.attributes[i].jsonObj);
        }

        var instanceIds = this.nodeIds;
        if (!(instanceIds && instanceIds.length)) {
            if (typeof onExecute === 'function') {
                onExecute({
                    message: "Empty Node List"
                }, null);
            }
            return;
        }

        instancesDao.getInstances(instanceIds, function(err, instances) {
            if (err) {
                logger.error(err);
                if (typeof onExecute === 'function') {
                    onExecute(err, null);
                }
                return;
            }


            var count = 0;
            var overallStatus = 0;
            var instanceResultList = [];
            var executionIds = [];

            function instanceOnCompleteHandler(err, status, instanceId, executionId, actionId) {
                logger.debug('Instance onComplete fired', count, instances.length);
                count++;
                var result = {
                    instanceId: instanceId,
                    status: 'success'
                }
                if (actionId) {
                    result.actionId = actionId;
                }
                if (executionId) {
                    result.executionId = executionId;
                }
                if (err) {
                    result.status = 'failed';
                    overallStatus = 1;
                } else {
                    if (status === 0) {
                        result.status = 'success';
                    } else {
                        result.status = 'failed';
                        overallStatus = 1;
                    }
                }
                instanceResultList.push(result);
                if (!(count < instances.length)) {
                    logger.debug('Type of onComplete: ' + typeof onComplete);
                    if (typeof onComplete === 'function') {
                        onComplete(null, overallStatus, {
                            instancesResults: instanceResultList
                        });
                    }
                }
            }
            for (var i = 0; i < instances.length; i++) {
                (function(instance) {
                    var timestampStarted = new Date().getTime();

                    var actionLog = instancesDao.insertOrchestrationActionLog(instance._id, self.runlist, userName, timestampStarted);
                    instance.tempActionLogId = actionLog._id;


                    var logsReferenceIds = [instance._id, actionLog._id];
                    if (!instance.instanceIP) {
                        var timestampEnded = new Date().getTime();
                        logsDao.insertLog({
                            referenceId: logsReferenceIds,
                            err: true,
                            log: "Instance IP is not defined. Chef Client run failed",
                            timestamp: timestampEnded
                        });
                        instancesDao.updateActionLog(instance._id, actionLog._id, false, timestampEnded);
                        instanceOnCompleteHandler({
                            message: "Instance IP is not defined. Chef Client run failed"
                        }, 1, instance._id, null, actionLog._id);
                        return;
                    }

                    // While passing extra attribute to chef cookbook "rlcatalyst" is used as attribute.
                    if (appData) {
                        if (appData.nexus) {
                            if (appData.nexus.nexusUrl) {
                                objectArray.push({
                                    "rlcatalyst": {
                                        "nexusUrl": appData.nexus.nexusUrl
                                    }
                                });
                            } else {
                                objectArray.push({
                                    "rlcatalyst": {
                                        "nexusUrl": appData.nexus.repoURL
                                    }
                                });
                            }

                            objectArray.push({
                                "rlcatalyst": {
                                    "version": appData.nexus.version
                                }
                            });
                        }
                        if (appData.docker) {
                            if (appData.docker.containerName) {
                                objectArray.push({
                                    "rlcatalyst": {
                                        "containerId": appData.docker.containerName
                                    }
                                });
                            }
                            if (appData.docker.containerPort) {
                                objectArray.push({
                                    "rlcatalyst": {
                                        "containerPort": appData.docker.containerPort
                                    }
                                });
                            }
                            if (appData.docker.dockerImage) {
                                objectArray.push({
                                    "rlcatalyst": {
                                        "dockerImage": appData.docker.dockerImage
                                    }
                                });
                            }

                            if (appData.docker.hostPort) {
                                objectArray.push({
                                    "rlcatalyst": {
                                        "hostPort": appData.docker.hostPort
                                    }
                                });
                            }
                            if (appData.docker.dockerUser) {
                                objectArray.push({
                                    "rlcatalyst": {
                                        "dockerUser": appData.docker.dockerUser
                                    }
                                });
                            }
                            if (appData.docker.dockerPassword) {
                                objectArray.push({
                                    "rlcatalyst": {
                                        "dockerPassword": appData.docker.dockerPassword
                                    }
                                });
                            }
                            if (appData.docker.dockerEmailId) {
                                objectArray.push({
                                    "rlcatalyst": {
                                        "dockerEmailId": appData.docker.dockerEmailId
                                    }
                                });
                            }
                            if (appData.docker.imageTag) {
                                objectArray.push({
                                    "rlcatalyst": {
                                        "imageTag": appData.docker.imageTag
                                    }
                                });
                            }
                        }

                        if (appData.upgrade) {
                            objectArray.push({
                                "rlcatalyst": {
                                    "upgrade": appData.upgrade
                                }
                            });
                        }
                        objectArray.push({
                            "rlcatalyst": {
                                "applicationNodeIP": instance.instanceIP
                            }
                        });
                        var nodeIds = [];
                        var appVersion = "";
                        var appName = "";
                        var nexus = {};
                        var docker = {};
                        if (appData.nexus) {
                            nexus['repoURL'] = appData.nexus.nexusUrl;
                            nexus['nodeIds'] = appData.nexus.nodeIds;
                            nexus['artifactId'] = appData.nexus.artifactId;
                            appName = appData.nexus.artifactId;
                            appVersion = appData.nexus.version;
                        }
                        if (appData.docker) {
                            docker['image'] = appData.docker.image;
                            docker['containerName'] = appData.docker.containerName;
                            docker['containerPort'] = appData.docker.containerPort;
                            docker['dockerUser'] = appData.docker.dockerUser;
                            docker['dockerPassword'] = appData.docker.dockerPassword;
                            docker['dockerEmailId'] = appData.docker.dockerEmailId;
                            docker['imageTag'] = appData.docker.imageTag;
                            docker['nodeIds'] = appData.docker.nodeIds;
                            docker['hostPort'] = appData.docker.hostPort;
                            appName = appData.docker.image;
                            appVersion = appData.docker.imageTag;
                        }
                        nodeIds.push(instance.instanceIP);
                        masterUtil.getEnvironmentName(instance.envId, function(envName) {
                            var appData = {
                                "projectId": instance.projectId,
                                "envName": envName,
                                "appName": appName,
                                "version": appVersion,
                                "nexus": nexus,
                                "docker": docker
                            };
                            AppData.createNewOrUpdate(appData, function(err, data) {
                                if (err) {
                                    logger.debug("Failed to create or update app-data: ", err);
                                }
                                if (data) {
                                    logger.debug("Created or Updated app-data successfully: ", data);
                                }
                            });
                        });

                        logger.debug("AppDeploy attributes: ", JSON.stringify(objectArray));
                        var attributeObj = utils.mergeObjects(objectArray);
                        configmgmtDao.getChefServerDetails(instance.chef.serverId, function(err, chefDetails) {
                            if (err) {
                                var timestampEnded = new Date().getTime();
                                logsDao.insertLog({
                                    referenceId: logsReferenceIds,
                                    err: true,
                                    log: "Chef Data Corrupted. Chef Client run failed",
                                    timestamp: timestampEnded
                                });
                                instancesDao.updateActionLog(instance._id, actionLog._id, false, timestampEnded);
                                instanceOnCompleteHandler(err, 1, instance._id, null, actionLog._id);
                                return;
                            }
                            if (!chefDetails) {
                                var timestampEnded = new Date().getTime();
                                logsDao.insertLog({
                                    referenceId: logsReferenceIds,
                                    err: true,
                                    log: "Chef Data Corrupted. Chef Client run failed",
                                    timestamp: timestampEnded
                                });
                                instancesDao.updateActionLog(instance._id, actionLog._id, false, timestampEnded);
                                instanceOnCompleteHandler({
                                    message: "Chef Data Corrupted. Chef Client run failed"
                                }, 1, instance._id, null, actionLog._id);
                                return;
                            }
                            //decrypting pem file
                            credentialCryptography.decryptCredential(instance.credentials, function(err, decryptedCredentials) {
                                if (err) {
                                    var timestampEnded = new Date().getTime();
                                    logsDao.insertLog({
                                        referenceId: logsReferenceIds,
                                        err: true,
                                        log: "Unable to decrypt pem file. Chef run failed",
                                        timestamp: timestampEnded
                                    });
                                    instancesDao.updateActionLog(instance._id, actionLog._id, false, timestampEnded);
                                    instanceOnCompleteHandler(err, 1, instance._id, null, actionLog._id);
                                    return;
                                }

                                ChefClientExecution.createNew({
                                    instanceId: instance._id

                                }, function(err, chefClientExecution) {
                                    if (err) {
                                        var timestampEnded = new Date().getTime();
                                        logsDao.insertLog({
                                            referenceId: logsReferenceIds,
                                            err: true,
                                            log: "Unable to generate chef run execution id. Chef run failed",
                                            timestamp: timestampEnded
                                        });
                                        instancesDao.updateActionLog(instance._id, actionLog._id, false, timestampEnded);
                                        instanceOnCompleteHandler(err, 1, instance._id, null, actionLog._id);
                                        return;
                                    }

                                    var executionIdJsonAttributeObj = {
                                        catalyst_attribute_handler: {
                                            catalystCallbackUrl: baseUrl + '/chefClientExecution/' + chefClientExecution.id
                                        }
                                    };

                                    var jsonAttributeObj = utils.mergeObjects([executionIdJsonAttributeObj, attributeObj]);
                                    var jsonAttributesString = JSON.stringify(jsonAttributeObj);

                                    var chef = new Chef({
                                        userChefRepoLocation: chefDetails.chefRepoLocation,
                                        chefUserName: chefDetails.loginname,
                                        chefUserPemFile: chefDetails.userpemfile,
                                        chefValidationPemFile: chefDetails.validatorpemfile,
                                        hostedChefUrl: chefDetails.url,
                                    });

                                    var chefClientOptions = {
                                        privateKey: decryptedCredentials.pemFileLocation,
                                        username: decryptedCredentials.username,
                                        host: instance.instanceIP,
                                        instanceOS: instance.hardware.os,
                                        port: 22,
                                        runlist: self.runlist, // runing service runlist
                                        jsonAttributes: jsonAttributesString,
                                        overrideRunlist: true,
                                        parallel: true
                                    }
                                    if (decryptedCredentials.pemFileLocation) {
                                        chefClientOptions.privateKey = decryptedCredentials.pemFileLocation;
                                    } else {
                                        chefClientOptions.password = decryptedCredentials.password;
                                    }
                                    logsDao.insertLog({
                                        referenceId: logsReferenceIds,
                                        err: false,
                                        log: "Executing Task",
                                        timestamp: new Date().getTime()
                                    });
                                    chef.runChefClient(chefClientOptions, function(err, retCode) {
                                        if (decryptedCredentials.pemFileLocation) {
                                            fileIo.removeFile(decryptedCredentials.pemFileLocation, function(err) {
                                                if (err) {
                                                    logger.error("Unable to delete temp pem file =>", err);
                                                } else {
                                                    logger.debug("temp pem file deleted");
                                                }
                                            });
                                        }
                                        if (err) {
                                            var timestampEnded = new Date().getTime();
                                            logsDao.insertLog({
                                                referenceId: logsReferenceIds,
                                                err: true,
                                                log: 'Unable to run chef-client',
                                                timestamp: timestampEnded
                                            });
                                            instancesDao.updateActionLog(instance._id, actionLog._id, false, timestampEnded);
                                            instanceOnCompleteHandler(err, 1, instance._id, chefClientExecution.id, actionLog._id);
                                            return;
                                        }
                                        if (retCode == 0) {
                                            var timestampEnded = new Date().getTime();
                                            logsDao.insertLog({
                                                referenceId: logsReferenceIds,
                                                err: false,
                                                log: 'Task execution success',
                                                timestamp: timestampEnded
                                            });
                                            instancesDao.updateActionLog(instance._id, actionLog._id, true, timestampEnded);
                                            instanceOnCompleteHandler(null, 0, instance._id, chefClientExecution.id, actionLog._id);
                                        } else {
                                            instanceOnCompleteHandler(null, retCode, instance._id, chefClientExecution.id, actionLog._id);
                                            if (retCode === -5000) {
                                                logsDao.insertLog({
                                                    referenceId: logsReferenceIds,
                                                    err: true,
                                                    log: 'Host Unreachable',
                                                    timestamp: new Date().getTime()
                                                });
                                            } else if (retCode === -5001) {
                                                logsDao.insertLog({
                                                    referenceId: logsReferenceIds,
                                                    err: true,
                                                    log: 'Invalid credentials',
                                                    timestamp: new Date().getTime()
                                                });
                                            } else {
                                                logsDao.insertLog({
                                                    referenceId: logsReferenceIds,
                                                    err: true,
                                                    log: 'Unknown error occured. ret code = ' + retCode,
                                                    timestamp: new Date().getTime()
                                                });
                                            }
                                            var timestampEnded = new Date().getTime();
                                            logsDao.insertLog({
                                                referenceId: logsReferenceIds,
                                                err: true,
                                                log: 'Error in running chef-client',
                                                timestamp: timestampEnded
                                            });
                                            instancesDao.updateActionLog(instance._id, actionLog._id, false, timestampEnded);
                                        }
                                    }, function(stdOutData) {
                                        logsDao.insertLog({
                                            referenceId: logsReferenceIds,
                                            err: false,
                                            log: stdOutData.toString('ascii'),
                                            timestamp: new Date().getTime()
                                        });
                                    }, function(stdOutErr) {
                                        logsDao.insertLog({
                                            referenceId: logsReferenceIds,
                                            err: true,
                                            log: stdOutErr.toString('ascii'),
                                            timestamp: new Date().getTime()
                                        });
                                    });
                                });
                            });

                        });
                    } else {
                        logger.debug("AppDeploy attributes: ", JSON.stringify(objectArray));
                        var attributeObj = utils.mergeObjects(objectArray);
                        configmgmtDao.getChefServerDetails(instance.chef.serverId, function(err, chefDetails) {
                            if (err) {
                                var timestampEnded = new Date().getTime();
                                logsDao.insertLog({
                                    referenceId: logsReferenceIds,
                                    err: true,
                                    log: "Chef Data Corrupted. Chef Client run failed",
                                    timestamp: timestampEnded
                                });
                                instancesDao.updateActionLog(instance._id, actionLog._id, false, timestampEnded);
                                instanceOnCompleteHandler(err, 1, instance._id, null, actionLog._id);
                                return;
                            }
                            if (!chefDetails) {
                                var timestampEnded = new Date().getTime();
                                logsDao.insertLog({
                                    referenceId: logsReferenceIds,
                                    err: true,
                                    log: "Chef Data Corrupted. Chef Client run failed",
                                    timestamp: timestampEnded
                                });
                                instancesDao.updateActionLog(instance._id, actionLog._id, false, timestampEnded);
                                instanceOnCompleteHandler({
                                    message: "Chef Data Corrupted. Chef Client run failed"
                                }, 1, instance._id, null, actionLog._id);
                                return;
                            }
                            //decrypting pem file
                            credentialCryptography.decryptCredential(instance.credentials, function(err, decryptedCredentials) {
                                if (err) {
                                    var timestampEnded = new Date().getTime();
                                    logsDao.insertLog({
                                        referenceId: logsReferenceIds,
                                        err: true,
                                        log: "Unable to decrypt pem file. Chef run failed",
                                        timestamp: timestampEnded
                                    });
                                    instancesDao.updateActionLog(instance._id, actionLog._id, false, timestampEnded);
                                    instanceOnCompleteHandler(err, 1, instance._id, null, actionLog._id);
                                    return;
                                }

                                ChefClientExecution.createNew({
                                    instanceId: instance._id

                                }, function(err, chefClientExecution) {
                                    if (err) {
                                        var timestampEnded = new Date().getTime();
                                        logsDao.insertLog({
                                            referenceId: logsReferenceIds,
                                            err: true,
                                            log: "Unable to generate chef run execution id. Chef run failed",
                                            timestamp: timestampEnded
                                        });
                                        instancesDao.updateActionLog(instance._id, actionLog._id, false, timestampEnded);
                                        instanceOnCompleteHandler(err, 1, instance._id, null, actionLog._id);
                                        return;
                                    }

                                    var executionIdJsonAttributeObj = {
                                        catalyst_attribute_handler: {
                                            catalystCallbackUrl: baseUrl + '/chefClientExecution/' + chefClientExecution.id
                                        }
                                    };

                                    var jsonAttributeObj = utils.mergeObjects([executionIdJsonAttributeObj, attributeObj]);
                                    var jsonAttributesString = JSON.stringify(jsonAttributeObj);

                                    var chef = new Chef({
                                        userChefRepoLocation: chefDetails.chefRepoLocation,
                                        chefUserName: chefDetails.loginname,
                                        chefUserPemFile: chefDetails.userpemfile,
                                        chefValidationPemFile: chefDetails.validatorpemfile,
                                        hostedChefUrl: chefDetails.url,
                                    });

                                    var chefClientOptions = {
                                        privateKey: decryptedCredentials.pemFileLocation,
                                        username: decryptedCredentials.username,
                                        host: instance.instanceIP,
                                        instanceOS: instance.hardware.os,
                                        port: 22,
                                        runlist: self.runlist, // runing service runlist
                                        jsonAttributes: jsonAttributesString,
                                        overrideRunlist: true,
                                        parallel: true
                                    }
                                    if (decryptedCredentials.pemFileLocation) {
                                        chefClientOptions.privateKey = decryptedCredentials.pemFileLocation;
                                    } else {
                                        chefClientOptions.password = decryptedCredentials.password;
                                    }
                                    logsDao.insertLog({
                                        referenceId: logsReferenceIds,
                                        err: false,
                                        log: "Executing Task",
                                        timestamp: new Date().getTime()
                                    });
                                    chef.runChefClient(chefClientOptions, function(err, retCode) {
                                        if (decryptedCredentials.pemFileLocation) {
                                            fileIo.removeFile(decryptedCredentials.pemFileLocation, function(err) {
                                                if (err) {
                                                    logger.error("Unable to delete temp pem file =>", err);
                                                } else {
                                                    logger.debug("temp pem file deleted");
                                                }
                                            });
                                        }
                                        if (err) {
                                            var timestampEnded = new Date().getTime();
                                            logsDao.insertLog({
                                                referenceId: logsReferenceIds,
                                                err: true,
                                                log: 'Unable to run chef-client',
                                                timestamp: timestampEnded
                                            });
                                            instancesDao.updateActionLog(instance._id, actionLog._id, false, timestampEnded);
                                            instanceOnCompleteHandler(err, 1, instance._id, chefClientExecution.id, actionLog._id);
                                            return;
                                        }
                                        if (retCode == 0) {
                                            var timestampEnded = new Date().getTime();
                                            logsDao.insertLog({
                                                referenceId: logsReferenceIds,
                                                err: false,
                                                log: 'Task execution success',
                                                timestamp: timestampEnded
                                            });
                                            instancesDao.updateActionLog(instance._id, actionLog._id, true, timestampEnded);
                                            instanceOnCompleteHandler(null, 0, instance._id, chefClientExecution.id, actionLog._id);
                                        } else {
                                            instanceOnCompleteHandler(null, retCode, instance._id, chefClientExecution.id, actionLog._id);
                                            if (retCode === -5000) {
                                                logsDao.insertLog({
                                                    referenceId: logsReferenceIds,
                                                    err: true,
                                                    log: 'Host Unreachable',
                                                    timestamp: new Date().getTime()
                                                });
                                            } else if (retCode === -5001) {
                                                logsDao.insertLog({
                                                    referenceId: logsReferenceIds,
                                                    err: true,
                                                    log: 'Invalid credentials',
                                                    timestamp: new Date().getTime()
                                                });
                                            } else {
                                                logsDao.insertLog({
                                                    referenceId: logsReferenceIds,
                                                    err: true,
                                                    log: 'Unknown error occured. ret code = ' + retCode,
                                                    timestamp: new Date().getTime()
                                                });
                                            }
                                            var timestampEnded = new Date().getTime();
                                            logsDao.insertLog({
                                                referenceId: logsReferenceIds,
                                                err: true,
                                                log: 'Error in running chef-client',
                                                timestamp: timestampEnded
                                            });
                                            instancesDao.updateActionLog(instance._id, actionLog._id, false, timestampEnded);
                                        }
                                    }, function(stdOutData) {
                                        logsDao.insertLog({
                                            referenceId: logsReferenceIds,
                                            err: false,
                                            log: stdOutData.toString('ascii'),
                                            timestamp: new Date().getTime()
                                        });
                                    }, function(stdOutErr) {
                                        logsDao.insertLog({
                                            referenceId: logsReferenceIds,
                                            err: true,
                                            log: stdOutErr.toString('ascii'),
                                            timestamp: new Date().getTime()
                                        });
                                    });
                                });
                            });

                        });
                    }

                })(instances[i]);
            }

            if (typeof onExecute === 'function') {
                onExecute(null, {
                    instances: instances,
                });
            }
        });
    }
};

var ChefTask = mongoose.model('chefTask', chefTaskSchema);

module.exports = ChefTask;
