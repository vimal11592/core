/* Copyright (C) Relevance Lab Private Limited- All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 * Written by Relevance UI Team,
 * Aug 2015
 */

(function(angular){
	"use strict";
	angular.module('workzone.orchestration')
		.controller('assignNodesCtrl', ['$scope', '$modalInstance', 'items', 'workzoneServices', function($scope, $modalInstance, items, workzoneServices) {
			$scope.runlistCollection = items.taskConfig.runlist || [];
			$scope.taskCollection = items.taskConfig.assignTasks;
			$scope.scriptIdCollection = items.taskConfig.scriptDetails;
			$scope.taskType = items.taskConfig.taskType;
			$scope.scriptTypeSelelct = items.taskConfig.scriptTypeName;
			$scope.scriptCollection = [];
			if(items.taskConfig.taskType == 'script') {
				workzoneServices.getScriptList($scope.scriptTypeSelelct).then(function (response) {
					if (response.data) {
						$scope.scriptDetails = response.data;
						for(var i=0;i<$scope.scriptDetails.length;i++){
							for (var j = 0; j < $scope.scriptIdCollection.length; j++) {
								if ($scope.scriptDetails[i]._id === $scope.scriptIdCollection[j].scriptId){
									$scope.scriptCollection.push($scope.scriptDetails[i]);
								}
							}
						}
					}
				});
			}
			$scope.cancel = function() {
				$modalInstance.dismiss('cancel');
			};
		}
	]);
})(angular);