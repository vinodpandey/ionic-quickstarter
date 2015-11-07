;(function () {
  "use strict";

  var UserProfileCtrl = /*@ngInject*/function ($scope, $rootScope, $state, $timeout, $ionicModal, $ionicActionSheet,
                                               $translate, $q, $stateParams, Application, ImageService, FileManager,
                                               UserProfileService, UserService) {

    var vm = this;
    var log = Application.getLogger('UserProfileCtrl');
    var user;

    // editing the profile image is only possible when running on a device (Cordova available)
    vm.canEditProfileImage = true;  angular.isDefined(window.cordova);

    // Keep track of whether a new profile image was uploaded and whether there was an old one
    var ImageUpload = function () {
      this.originalImage = null;

      this.setUploaded = function (newImage) {

        // if a new file was uploaded successfully then remove the old/previous file, if any
        // (each time a new image is uploaded we generate a new unique file name, this is for HTML "cache busting")
        if (this.originalImage && this.originalImage !== newImage) {

          var targetDir = cordova.file.dataDirectory;
          FileManager.removeFile(targetDir, this.originalImage);
        }

        this.originalImage = newImage;
      };
    };

    var profileImage = new ImageUpload();

    vm.user = {};

    function load() {
      vm.user = angular.extend({email: user.userName}, UserProfileService.retrieveProfile());

      profileImage.originalImage = vm.user.profileImage;
    }

    $scope.$on('$ionicView.beforeEnter', function (event, viewData) {
      log.debug("beforeEnter start ...");

      user = UserService.currentUser();

      Application.resetForm(vm);
      Application.contentBannerInit(vm, $scope);

      load();

      var key = 'manage.userProfile.title';

      $translate(key).then(function (translation) {
        vm.title = translation;
      });

      log.debug("beforeEnter end");
    });

    //
    // Use Javascript object getters/setters for 'computed' model properties, see:
    //
    // http://stackoverflow.com/questions/19526938/what-is-the-analog-for-knockouts-writable-computed-observable-in-angularjs/19548980#19548980
    //

    Object.defineProperty(vm, 'isMale', {
      get: function () {
        return vm.user.sex && vm.user.sex == 'M';
      },
      set: function (newValue) {
        vm.user.sex = 'M';
      }
    });

    Object.defineProperty(vm, 'isFemale', {
      get: function () {
        return vm.user.sex && vm.user.sex == 'F';
      },
      set: function (newValue) {
        vm.user.sex = 'F';
      }
    });

    // ---- IMAGE UPLOAD ----

    vm.uploadProfileImage = function () {
      getImage(saveProfileImage, cropProfileImage, 'upload-profile-photo', getFileName('profile'));
    };

    function getFileName(baseName) {
      return baseName + '-' + Date.now() + '.jpg';
    }

    function getImage(saveImageFn, cropImageFn, imageKey, fileName) {
      var titleKey = 'manage.profile.' + imageKey;
      var key = 'media-dialog.';

      $translate([titleKey, key + 'cancel-text', key + 'buttons.camera', key + 'buttons.library'])
        .then(function (translations) {

          vm.hideSheet = $ionicActionSheet.show({
            titleText: translations[titleKey],
            cancelText: translations[key + 'cancel-text'],
            buttons: [
              { text: '<i class="icon ion-ios-camera-outline"></i> ' + translations[key + 'buttons.camera'] },
              { text: '<i class="icon ion-ios-folder-outline"></i> ' + translations[key + 'buttons.library'] }
            ],
            buttonClicked: function(index) {
              vm.hideSheet();

              addImage(index, saveImageFn, cropImageFn, fileName);
            }
          });
        });

    }

    function getImageOpts() {
      // JPEG quality 50%, good enough - difference with 100% is invisbible to the naked eye
      // (50 is actually the default value of the cordova-plugin-camera plugin. for camera images)
      return {
        pictureQuality: 50,
        targetSize: 600    // set image size to 600 pixels, larger is useless; otherwise the JPEG file will be huge
      };
    }

    function addImage(type, saveImageFn, cropImageFn, fileName) {
      // Set image options (quality, height/width)
      var imageOpts = getImageOpts();

      var targetDir = cordova.file.dataDirectory;   // target directory on the native file system
      var fileUrl = null;       // file URL on the native file system

      //
      // Now execute all the steps of the "pipeline" via Promise chaining:
      //

      ImageService.getPicture(type, imageOpts.pictureQuality, imageOpts.targetSize).then(function(imageUrl) {
        log.debug("ImageService#getPicture imageUrl = '" + imageUrl + "'");

        return FileManager.downloadFile(imageUrl, targetDir, 'uncropped-' + fileName);

      }).then(function (result) {
        log.debug("FileManager#downloadFile uncropped result = " + JSON.stringify(result));
        fileUrl = result.nativeURL;

        // image file downloaded to the native file system, clean up the temp files
        ImageService.cleanup();

        return FileManager.getFileInfo(targetDir, 'uncropped-' + fileName);

      }).then(function (result) {
        log.debug("FileManager#getFileInfo uncropped result = " + JSON.stringify(result));

        log.info("FileManager#getFileInfo uncropped file = '" + 'uncropped-' + fileName +"', size = " + result.size);

        return cropImageFn(fileUrl);

      }).then(function (croppedImage) {
        log.debug("cropImage");

        return FileManager.downloadFile(croppedImage, targetDir, 'cropped-' + fileName);

      }).then(function (result) {
        log.debug("FileManager#downloadFile cropped file result = " + JSON.stringify(result));
        fileUrl = result.nativeURL;

        // cropped file has been downloaded, remove the uncropped file now
        return FileManager.removeFile(targetDir, 'uncropped-' + fileName);

      }).then(function (result) {
        log.debug("FileManager#removeFile uncropped result = " + JSON.stringify(result));

        saveImageFn(fileUrl);

        profileImage.setUploaded(vm.user.profileImage);

        Application.contentBannerShow(vm, 'message.image-was-saved');

      }).catch(function (error) {

        if (typeof error === 'string' && error.match(/cancelled/i)) {
          log.debug("Operation was cancelled, error: " + error);

          Application.contentBannerShow(vm, 'message.image-was-not-saved');

        } else {
          log.error("Error in addImage: " + JSON.stringify(error));

          Application.contentBannerShow(vm,
            ['message.image-was-not-saved1', 'message.image-was-not-saved2', 'message.image-was-not-saved3'],
            3000, 0
          );
        }
      });
    }

    function saveProfileImage(url) {
      // set the image URL to the new uploaded file's URL
      vm.user.profileImage = url;

      UserProfileService.saveProfile(vm.user);
    }

    function cropProfileImage(fileUrl) {
      return cropImage(fileUrl, 1);
    }

    // ---- IMAGE CROP MODAL ----

    function cropImage(fileUrl, widthHeightRatio) {
      var deferred = $q.defer();

      vm.imageCropSaveCallback = function (croppedImage) {
        deferred.resolve(croppedImage);
      };

      vm.imageCropCancelCallback = function () {
        deferred.reject('cancelled');
      };

      vm.showImageCropModal(fileUrl, widthHeightRatio);

      return deferred.promise;
    }

    $ionicModal.fromTemplateUrl('js/app/manage/image-crop-modal.html', {scope: $scope, animation: 'slide-in-up'})
      .then(function(modal) {

        vm.imageCropModal = modal;
        vm.imageCropSaveCallback = null;
        vm.imageCropCancelCallback = null;
      });

    vm.showImageCropModal = function(image, widthHeightRatio) {

      vm.imageCropModal.show().then(function () {

        //
        // NOTE: for cropping to work, the source (original) and target (cropped) image variables should be put in a
        // container object (see below, $scope.image), NOT directly in the $scope variable itself; for background see:
        //
        // https://github.com/alexk111/ngImgCrop/issues/18#issuecomment-78911464
        //

        // add an object to $scope which wraps the to-be-cropped image and the cropped (result) image; otherwise it
        // will not work (see https://github.com/alexk111/ngImgCrop/issues/18). We also add config properties to it.
        $scope.image = {
          originalImage: image,
          croppedImage: '',
          aspectRatio: widthHeightRatio + "x" + 1
        };
      });
    };

    $scope.saveImageCropModal = function() {
      if (vm.imageCropSaveCallback) {
        vm.imageCropSaveCallback($scope.image.croppedImage);
        vm.imageCropSaveCallback = null;
      }
      vm.imageCropModal.hide();
    };

    $scope.closeImageCropModal = function() {
      if (vm.imageCropCancelCallback) {
        vm.imageCropCancelCallback();
        vm.imageCropCancelCallback = null;
      }
      vm.imageCropModal.hide();
    };

    $scope.$on('$destroy', function() {
      if (vm.imageCropModal) {
        vm.imageCropModal.remove();
        vm.imageCropModal = null;
      }
    });

    // ---- SAVE DATA ----

    vm.save = function (form) {

      // ad-hoc form validation (maybe better solved with custom validators)
      if (!vm.user.sex) {
        form.$valid = false;
      }

      if (!form.$valid) {
        Application.errorMessage(vm, 'message.invalid-fields');
        return;
      }

      if (!form.$dirty) {
        return;
      }

      UserProfileService.saveProfile(vm.user);

      // set the form to "pristine" (i.e. set 'dirty' to false) because the form has been saved now; otherwise the
      // "form-dirty-check" directive would be triggering the "is dirty" check
      form.$setPristine();

      Application.clearErrorMessage(vm);

      var message = 'message.data-was-saved';

      // the '$timeout' is needed to let AngularJS process its digest loop after calling "form.$setPristine()",
      // see: http://stackoverflow.com/questions/779379/why-is-settimeoutfn-0-sometimes-useful
      $timeout(function () {
        Application.contentBannerShow(vm, message);
      }, 0);
    };

  };

  appModule('app.manage').controller('UserProfileCtrl', UserProfileCtrl)
    .config(function ($stateProvider) {
      $stateProvider
        .state('app.auth.userProfile', {
          url: '/userProfile',
          views: {
            'menuContent@app': {
              templateUrl: 'js/app/manage/userProfile.html',
              controller: 'UserProfileCtrl as vm'
            }
          }
        })
      ;
    })
  ;
}());
